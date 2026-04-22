import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { type AgentEntry, publishNameForAgent } from './catalog'
import type { ContainerArch } from './schema/arch'

const PODMAN_BIN = process.env.PODMAN_BIN ?? 'podman'

interface PodmanCommandResult {
  stdout: string
  stderr: string
}

interface PodmanInspectShape {
  Id?: string
  Digest?: string
  RepoDigests?: string[]
  Architecture?: string
  Os?: string
  Config?: unknown
  RootFS?: unknown
}

interface PodmanImageMetadata {
  imageId: string
  sourceOciDigest: string
  smokeFingerprint: string
}

export interface BuildOptions {
  agent: AgentEntry
  arch: ContainerArch
  outputDir: string
  recipePath?: string
  builtBy?: string
}

export interface BuildResult {
  name: string
  publishAs: string
  image: string
  version: string
  arch: ContainerArch
  sourceOciDigest: string
  imageId: string
  smokeFingerprint: string
  filename: string
  tarballPath: string
  tarballShaPath: string
  compressedSha256: string
  compressedSizeBytes: number
  uncompressedSha256: string
  uncompressedSizeBytes: number
  podmanVersion: string
  builtAt: string
  builtBy: string
  gitSha: string
  gitDirty: boolean
  configSha256: string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    )
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function smokeFingerprintForInspect(inspected: PodmanInspectShape): string {
  const payload = stableJson({
    Architecture: inspected.Architecture ?? '',
    Os: inspected.Os ?? '',
    Config: inspected.Config ?? null,
    RootFS: inspected.RootFS ?? null,
  })
  return createHash('sha256').update(payload).digest('hex')
}

function normalizeSha256Like(value: string): string {
  const trimmed = value.trim()
  if (/^sha256:[a-f0-9]{64}$/.test(trimmed)) {
    return trimmed
  }
  if (/^[a-f0-9]{64}$/.test(trimmed)) {
    return `sha256:${trimmed}`
  }

  throw new Error(`unexpected sha256-like value: ${value}`)
}

async function runPodman(
  args: string[],
  options: { stdin?: string } = {},
): Promise<PodmanCommandResult> {
  const proc = Bun.spawn([PODMAN_BIN, ...args], {
    stdin: options.stdin ? Buffer.from(`${options.stdin}\n`) : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(
      `podman ${args.join(' ')} exited ${exitCode}\n${stderr.trim() || stdout.trim()}`,
    )
  }

  return { stdout, stderr }
}

async function runCommand(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(' ')} exited ${exitCode}\n${stderr.trim() || stdout.trim()}`,
    )
  }

  return stdout.trim()
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

async function gzipArchive(tarPath: string): Promise<void> {
  const proc = Bun.spawn(['gzip', '-9', '-f', '-k', tarPath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`gzip exited ${exitCode}\n${stderr.trim()}`)
  }
}

async function gitSha(): Promise<string> {
  return runCommand(['git', 'rev-parse', 'HEAD'])
}

async function gitDirty(): Promise<boolean> {
  const stdout = await runCommand(['git', 'status', '--short'])
  return stdout.length > 0
}

function recipePathForPackage(): string {
  return resolve(import.meta.dir, '..', 'recipe', 'agents.json')
}

function imageRefForBuild(options: BuildOptions): string {
  return `${options.agent.image}:${options.agent.version}`
}

function builtByForBuild(explicitBuiltBy?: string): string {
  if (explicitBuiltBy) {
    return explicitBuiltBy
  }

  const workflowRef = process.env.GITHUB_WORKFLOW_REF?.trim()
  if (workflowRef) {
    return workflowRef
  }

  const workflow = process.env.GITHUB_WORKFLOW?.trim()
  const ref = process.env.GITHUB_REF?.trim()
  if (workflow && ref) {
    return `${workflow}@${ref}`
  }

  const user = process.env.USER ?? process.env.LOGNAME ?? 'unknown'
  return `local:${user}`
}

export function registryForImage(image: string): string {
  const firstSegment = image.split('/')[0]
  if (
    !firstSegment ||
    (!firstSegment.includes('.') &&
      !firstSegment.includes(':') &&
      firstSegment !== 'localhost')
  ) {
    return 'docker.io'
  }

  return firstSegment
}

async function podmanVersion(): Promise<string> {
  const { stdout } = await runPodman(['--version'])
  return stdout.trim()
}

async function podmanLogin(options: {
  registry: string
  username: string
  password: string
}): Promise<void> {
  await runPodman(
    [
      'login',
      '--username',
      options.username,
      '--password-stdin',
      options.registry,
    ],
    { stdin: options.password },
  )
}

async function podmanPull(
  imageRef: string,
  arch: ContainerArch,
): Promise<void> {
  await runPodman([
    'pull',
    '--quiet',
    '--os',
    'linux',
    '--arch',
    arch,
    imageRef,
  ])
}

export async function podmanInspectImage(
  imageRef: string,
): Promise<PodmanImageMetadata> {
  const { stdout } = await runPodman([
    'inspect',
    '--type',
    'image',
    '--format',
    '{{json .}}',
    imageRef,
  ])
  const inspected = JSON.parse(stdout.trim()) as PodmanInspectShape
  const imageId = normalizeSha256Like(inspected.Id ?? '')
  const platformDigest = normalizeSha256Like(inspected.Digest ?? imageId)
  const repoDigests = [
    ...new Set(
      (inspected.RepoDigests ?? [])
        .map((entry) => entry.split('@')[1] ?? '')
        .filter(Boolean)
        .map((entry) => normalizeSha256Like(entry)),
    ),
  ]
  const sourceOciDigest =
    repoDigests.find((digest) => digest !== platformDigest) ?? platformDigest

  return {
    imageId,
    sourceOciDigest,
    smokeFingerprint: smokeFingerprintForInspect(inspected),
  }
}

async function podmanSaveOci(options: {
  imageRef: string
  outPath: string
}): Promise<void> {
  await runPodman([
    'save',
    '--format',
    'oci-archive',
    '--output',
    options.outPath,
    options.imageRef,
  ])
}

export async function podmanLoadArchive(tarballPath: string): Promise<void> {
  await runPodman(['load', '--input', tarballPath])
}

export async function podmanRemoveImage(imageRef: string): Promise<void> {
  await runPodman(['rmi', '-f', imageRef])
}

async function maybeLoginForAgent(options: BuildOptions): Promise<void> {
  const auth = options.agent.requires_auth
  if (!auth) {
    return
  }

  const password = process.env[auth.secret]?.trim()
  if (!password) {
    throw new Error(`missing registry credential env var: ${auth.secret}`)
  }

  await podmanLogin({
    registry: registryForImage(options.agent.image),
    username: auth.username ?? 'oauth2accesstoken',
    password,
  })
}

export async function buildTarball(
  options: BuildOptions,
): Promise<BuildResult> {
  const imageRef = imageRefForBuild(options)
  const publishAs = publishNameForAgent(options.agent)
  const outputDir = resolve(options.outputDir)
  const recipePath = resolve(options.recipePath ?? recipePathForPackage())
  const baseName = `${publishAs}-${options.agent.version}-${options.arch}.tar`
  const tarPath = join(outputDir, baseName)
  const tarballPath = `${tarPath}.gz`
  const tarballShaPath = `${tarballPath}.sha256`
  const buildResultPath = join(outputDir, 'build-result.json')

  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    rm(tarPath, { force: true }),
    rm(tarballPath, { force: true }),
    rm(tarballShaPath, { force: true }),
    rm(buildResultPath, { force: true }),
  ])

  const [gitShaValue, gitDirtyValue, configSha256, podmanVersionValue] =
    await Promise.all([
      gitSha(),
      gitDirty(),
      sha256OfFile(recipePath),
      podmanVersion(),
    ])
  const builtAt = new Date().toISOString()
  const builtBy = builtByForBuild(options.builtBy)

  await maybeLoginForAgent(options)
  await podmanPull(imageRef, options.arch)
  const inspection = await podmanInspectImage(imageRef)
  await podmanSaveOci({ imageRef, outPath: tarPath })
  await gzipArchive(tarPath)

  const [
    compressedSha256,
    uncompressedSha256,
    compressedStats,
    uncompressedStats,
  ] = await Promise.all([
    sha256OfFile(tarballPath),
    sha256OfFile(tarPath),
    stat(tarballPath),
    stat(tarPath),
  ])

  const filename = basename(tarballPath)
  await writeFile(tarballShaPath, `${compressedSha256}  ${filename}\n`, 'utf8')
  await rm(tarPath, { force: true })

  const result: BuildResult = {
    name: options.agent.name,
    publishAs,
    image: options.agent.image,
    version: options.agent.version,
    arch: options.arch,
    sourceOciDigest: inspection.sourceOciDigest,
    imageId: inspection.imageId,
    smokeFingerprint: inspection.smokeFingerprint,
    filename,
    tarballPath,
    tarballShaPath,
    compressedSha256,
    compressedSizeBytes: compressedStats.size,
    uncompressedSha256,
    uncompressedSizeBytes: uncompressedStats.size,
    podmanVersion: podmanVersionValue,
    builtAt,
    builtBy,
    gitSha: gitShaValue,
    gitDirty: gitDirtyValue,
    configSha256,
  }

  await writeFile(
    buildResultPath,
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  )
  return result
}

export async function loadBuildResult(path: string): Promise<BuildResult> {
  const raw = await readFile(path, 'utf8')
  const result = JSON.parse(raw) as BuildResult
  const resultDir = dirname(path)
  const tarballPath = (await pathExists(result.tarballPath))
    ? result.tarballPath
    : join(resultDir, result.filename)
  const tarballShaPath = (await pathExists(result.tarballShaPath))
    ? result.tarballShaPath
    : `${tarballPath}.sha256`

  return {
    ...result,
    tarballPath,
    tarballShaPath,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
