import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { $ } from 'bun'
import { assertCalver } from '../schema/arch'
import { DEBIAN_BASE_IMAGES, debianSha256SumsUrl } from './base-image'
import {
  composeVirtCustomizeArgv,
  parsePackagesOutput,
  parseRecipe,
} from './recipe'
import type { BuildOptions, BuildResult } from './types'

const DEFAULT_RECIPE_REL = '../../recipe/browseros-vm.recipe'

export async function buildDisk(opts: BuildOptions): Promise<BuildResult> {
  assertCalver(opts.version)
  const base = DEBIAN_BASE_IMAGES[opts.arch]
  const pinnedSha =
    opts.baseImageShaOverride ??
    (await resolvePinnedSha(base.upstreamVersion, base))

  await $`mkdir -p ${opts.outputDir}`.quiet()
  const basePath = path.join(opts.outputDir, `base-${opts.arch}.qcow2`)
  await downloadTo(base.url, basePath)
  await verifySha256(basePath, pinnedSha)

  const workPath = path.join(
    opts.outputDir,
    `work-${opts.version}-${opts.arch}.qcow2`,
  )
  await copyFile(basePath, workPath)

  const recipePath =
    opts.recipePath ?? path.resolve(import.meta.dir, DEFAULT_RECIPE_REL)
  const recipeText = await readFile(recipePath, 'utf8')
  const recipeSha = sha256String(recipeText)

  const manifestStubPath = path.join(
    opts.outputDir,
    `manifest-stub-${opts.arch}.json`,
  )
  await writeFile(
    manifestStubPath,
    JSON.stringify({ version: opts.version, arch: opts.arch }, null, 2),
  )

  const argv = composeVirtCustomizeArgv({
    diskPath: workPath,
    recipe: parseRecipe(recipeText),
    substitutions: {
      version: opts.version,
      manifest_tmp: manifestStubPath,
    },
    recipeDir: path.dirname(recipePath),
  })
  const buildLogPath = path.join(opts.outputDir, `build-${opts.arch}.log`)
  await spawnToLog(['virt-customize', ...argv], buildLogPath)

  await $`virt-sparsify --in-place ${workPath}`.quiet()

  const finalRawPath = path.join(
    opts.outputDir,
    `browseros-vm-${opts.version}-${opts.arch}.qcow2`,
  )
  await $`qemu-img convert -O qcow2 -c ${workPath} ${finalRawPath}`.quiet()

  const rawSha = await sha256File(finalRawPath)
  const rawSize = (await stat(finalRawPath)).size

  const compressedPath = `${finalRawPath}.zst`
  await $`zstd -19 --long=30 -T0 -f -o ${compressedPath} ${finalRawPath}`.quiet()
  const compressedSha = await sha256File(compressedPath)
  const compressedSize = (await stat(compressedPath)).size

  const packages = await readPackagesFromDisk(
    workPath,
    opts.outputDir,
    opts.arch,
  )

  await rm(workPath, { force: true })
  await rm(basePath, { force: true })

  return {
    arch: opts.arch,
    version: opts.version,
    baseImage: { ...base, sha256: pinnedSha },
    recipeSha256: recipeSha,
    rawQcowPath: finalRawPath,
    rawQcowSha256: rawSha,
    rawQcowSize: rawSize,
    compressedPath,
    compressedSha256: compressedSha,
    compressedSize,
    packages,
    buildLogPath,
  }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${url} (${response.status})`)
  }
  await pipeline(
    Readable.fromWeb(response.body as never),
    Bun.file(dest).writer() as never,
  )
}

async function verifySha256(filePath: string, expected: string): Promise<void> {
  const actual = await sha256File(filePath)
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${filePath}: expected ${expected}, got ${actual}`,
    )
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function sha256String(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function spawnToLog(argv: string[], logPath: string): Promise<void> {
  const log = Bun.file(logPath).writer()
  const proc = Bun.spawn(argv, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      LIBGUESTFS_BACKEND: process.env.LIBGUESTFS_BACKEND ?? 'direct',
    },
  })
  await Promise.all([
    pumpStream(proc.stdout, log),
    pumpStream(proc.stderr, log),
  ])
  const code = await proc.exited
  await log.end()
  if (code !== 0) {
    throw new Error(`${argv[0]} exited ${code}; see ${logPath}`)
  }
}

async function pumpStream(
  stream: ReadableStream<Uint8Array>,
  sink: ReturnType<typeof Bun.file>['writer'] extends () => infer W ? W : never,
): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    sink.write(value)
  }
}

async function readPackagesFromDisk(
  diskPath: string,
  outputDir: string,
  arch: string,
): Promise<Record<string, string>> {
  const dumpPath = path.join(outputDir, `pkgs-${arch}.txt`)
  await $`virt-copy-out -a ${diskPath} /var/lib/browseros-vm-pkg-versions ${outputDir}`.quiet()
  await $`mv ${outputDir}/browseros-vm-pkg-versions ${dumpPath}`.quiet()
  const text = await readFile(dumpPath, 'utf8')
  return parsePackagesOutput(text)
}

async function resolvePinnedSha(
  upstreamVersion: string,
  base: { arch: string; url: string; sha256: string },
): Promise<string> {
  if (base.sha256 && !base.sha256.startsWith('replace-with-real'))
    return base.sha256
  const sumsUrl = debianSha256SumsUrl(upstreamVersion)
  const response = await fetch(sumsUrl)
  if (!response.ok) throw new Error(`SHA256SUMS fetch failed: ${sumsUrl}`)
  const text = await response.text()
  const filename = base.url.slice(base.url.lastIndexOf('/') + 1)
  for (const line of text.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (name === filename && sha) return sha
  }
  throw new Error(`SHA256SUMS missing entry for ${filename}`)
}
