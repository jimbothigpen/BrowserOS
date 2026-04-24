#!/usr/bin/env bun
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { createGunzip } from 'node:zlib'
import { parseArch, podmanArch } from './common/arch'
import type { Bundle } from './common/manifest'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: { type: 'string' },
    arch: { type: 'string' },
    tarball: { type: 'string' },
  },
})

if (!values.agent || !values.arch || !values.tarball) {
  console.error(
    'usage: smoke:tarball -- --agent <name> --arch <arm64|x64> --tarball <path.tar.gz>',
  )
  process.exit(1)
}

const arch = parseArch(values.arch)
const pkgRoot = path.resolve(import.meta.dir, '..')
const bundle = JSON.parse(
  await readFile(path.join(pkgRoot, 'bundle.json'), 'utf8'),
) as Bundle
const agent = bundle.agents.find(({ name }) => name === values.agent)
if (!agent) throw new Error(`unknown agent: ${values.agent}`)

const ref = `${agent.image}:${agent.version}`
const tarball = await maybeDecompress(values.tarball)

try {
  await spawnChecked(['podman', 'rmi', '-f', ref]).catch(() => {})
  await spawnChecked(['podman', 'load', '--input', tarball.path])
  const inspected = await inspectImage(ref)
  if (inspected.Os !== 'linux') {
    throw new Error(`expected linux image, got ${inspected.Os ?? '<missing>'}`)
  }
  if (inspected.Architecture !== podmanArch(arch)) {
    throw new Error(
      `expected ${podmanArch(arch)} image, got ${inspected.Architecture ?? '<missing>'}`,
    )
  }
} finally {
  await spawnChecked(['podman', 'rmi', '-f', ref]).catch(() => {})
  if (tarball.cleanupDir) {
    await rm(tarball.cleanupDir, { recursive: true, force: true })
  }
}

console.log('tarball smoke test passed')

async function maybeDecompress(
  tarballPath: string,
): Promise<{ path: string; cleanupDir?: string }> {
  if (!tarballPath.endsWith('.gz')) return { path: tarballPath }

  const cleanupDir = await mkdtemp(path.join(tmpdir(), 'browseros-tar-smoke-'))
  const tarPath = path.join(cleanupDir, 'image.tar')
  await pipeline(
    createReadStream(tarballPath),
    createGunzip(),
    createWriteStream(tarPath),
  )
  return { path: tarPath, cleanupDir }
}

async function inspectImage(ref: string): Promise<{
  Architecture?: string
  Os?: string
}> {
  const stdout = await spawnCapture([
    'podman',
    'inspect',
    '--type',
    'image',
    '--format',
    '{{json .}}',
    ref,
  ])
  return JSON.parse(stdout) as { Architecture?: string; Os?: string }
}

async function spawnCapture(argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    throw new Error(
      `${argv[0]} exited ${code}\n${stderr.trim() || stdout.trim()}`,
    )
  }
  return stdout.trim()
}

async function spawnChecked(argv: string[]): Promise<void> {
  await spawnCapture(argv)
}
