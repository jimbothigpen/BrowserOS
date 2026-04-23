#!/usr/bin/env bun
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import type { Arch } from './common/arch'
import {
  type AgentEntry,
  type AgentManifest,
  type Bundle,
  tarballKey,
} from './common/manifest'
import { sha256File, verifySha256 } from './common/sha256'

const ARM64: Arch = 'arm64'

if (process.env.NODE_ENV !== 'development') {
  throw new Error(
    'cache:sync:dev refuses to run without NODE_ENV=development — it writes to ~/.browseros-dev/cache/vm/',
  )
}

const pkgRoot = path.resolve(import.meta.dir, '..')
const distDir = path.join(pkgRoot, 'dist')
const bundle = JSON.parse(
  await readFile(path.join(pkgRoot, 'bundle.json'), 'utf8'),
) as Bundle

const cacheRoot = path.join(
  homedir(),
  PATHS.DEV_BROWSEROS_DIR_NAME,
  PATHS.CACHE_DIR_NAME,
)
const imagesDir = path.join(cacheRoot, 'vm', 'images')
const manifestPath = path.join(cacheRoot, 'vm', 'manifest.json')
await mkdir(imagesDir, { recursive: true })

const agents: Record<string, AgentEntry> = {}
for (const agent of bundle.agents) {
  const key = tarballKey(agent.name, agent.version, ARM64)
  const srcTarball = path.join(distDir, 'images', path.basename(key))
  await assertExists(srcTarball)

  const sha256 = await sha256File(srcTarball)
  const sizeBytes = (await stat(srcTarball)).size
  const destTarball = path.join(cacheRoot, key)

  if (await matchesExisting(destTarball, sha256)) {
    console.log(`cache hit: ${key}`)
  } else {
    await mkdir(path.dirname(destTarball), { recursive: true })
    await copyFile(srcTarball, destTarball)
    await verifySha256(destTarball, sha256)
    console.log(`seeded ${key}`)
  }

  agents[agent.name] = {
    image: agent.image,
    version: agent.version,
    tarballs: { arm64: { key, sha256, sizeBytes } } as AgentEntry['tarballs'],
  }
}

const manifest: AgentManifest = {
  schemaVersion: 2,
  updatedAt: new Date().toISOString(),
  agents,
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`manifest written to ${manifestPath}`)

async function assertExists(filePath: string): Promise<void> {
  try {
    await stat(filePath)
  } catch {
    throw new Error(
      `missing ${filePath} — run: bun run build:tarball -- --agent <name> --arch arm64`,
    )
  }
}

async function matchesExisting(
  filePath: string,
  expectedSha: string,
): Promise<boolean> {
  try {
    await stat(filePath)
  } catch {
    return false
  }
  return (await sha256File(filePath)) === expectedSha
}
