import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSkillsDir } from '../lib/browseros-dir'
import { logger } from '../lib/logger'
import { DEFAULT_SKILLS } from './defaults'
import { loadManifest, seedFromRemote } from './remote-sync'
import type { SkillManifest } from './types'

async function hasExistingSkills(skillsDir: string): Promise<boolean> {
  try {
    const entries = await readdir(skillsDir)
    return entries.some((e) => !e.startsWith('.'))
  } catch {
    return false
  }
}

async function seedFromBundled(manifest: SkillManifest): Promise<void> {
  const skillsDir = getSkillsDir()
  let seeded = 0
  for (const skill of DEFAULT_SKILLS) {
    try {
      const targetDir = join(skillsDir, skill.id)
      await mkdir(targetDir, { recursive: true })
      await writeFile(join(targetDir, 'SKILL.md'), skill.content)
      manifest.skills[skill.id] = {
        version: '1.0',
        contentHash: createHash('sha256').update(skill.content).digest('hex'),
      }
      seeded++
    } catch (err) {
      logger.warn('Failed to seed skill', {
        id: skill.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (seeded > 0) {
    logger.info(`Seeded ${seeded} default skills (bundled)`)
  }
}

export async function seedDefaultSkills(): Promise<void> {
  const skillsDir = getSkillsDir()
  if (await hasExistingSkills(skillsDir)) return

  const remoteSucceeded = await seedFromRemote()
  if (remoteSucceeded) return

  const manifest = await loadManifest()
  await seedFromBundled(manifest)

  const manifestPath = join(skillsDir, '.remote-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}
