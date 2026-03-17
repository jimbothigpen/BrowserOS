import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'
import { getSkillsDir } from '../lib/browseros-dir'
import { logger } from '../lib/logger'
import type {
  ManagedSkillRecord,
  RemoteSkillCatalog,
  RemoteSkillEntry,
  SkillManifest,
} from './types'

const MANIFEST_FILE = '.remote-manifest.json'

let syncTimer: ReturnType<typeof setInterval> | null = null

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function getManifestPath(): string {
  return join(getSkillsDir(), MANIFEST_FILE)
}

export async function loadManifest(): Promise<SkillManifest> {
  try {
    const raw = await readFile(getManifestPath(), 'utf-8')
    return JSON.parse(raw) as SkillManifest
  } catch {
    return { lastSyncedAt: '', skills: {} }
  }
}

async function saveManifest(manifest: SkillManifest): Promise<void> {
  await writeFile(getManifestPath(), JSON.stringify(manifest, null, 2))
}

export async function fetchRemoteCatalog(): Promise<RemoteSkillCatalog | null> {
  try {
    const response = await fetch(EXTERNAL_URLS.SKILLS_CATALOG, {
      signal: AbortSignal.timeout(TIMEOUTS.SKILLS_FETCH),
    })
    if (!response.ok) {
      logger.warn('Failed to fetch remote skill catalog', {
        status: response.status,
      })
      return null
    }
    return (await response.json()) as RemoteSkillCatalog
  } catch (err) {
    logger.debug('Remote skill catalog unavailable', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function isSkillCustomized(
  skillId: string,
  currentContent: string,
  manifest: SkillManifest,
): boolean {
  const record = manifest.skills[skillId]
  if (!record) return false
  return contentHash(currentContent) !== record.contentHash
}

async function readSkillContent(skillId: string): Promise<string | null> {
  try {
    return await readFile(
      join(getSkillsDir(), skillId, 'SKILL.md'),
      'utf-8',
    )
  } catch {
    return null
  }
}

async function writeSkillFile(
  skillId: string,
  content: string,
): Promise<void> {
  const targetDir = join(getSkillsDir(), skillId)
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, 'SKILL.md'), content)
}

async function installSkill(
  skill: RemoteSkillEntry,
  manifest: SkillManifest,
): Promise<void> {
  await writeSkillFile(skill.id, skill.content)
  manifest.skills[skill.id] = {
    version: skill.version,
    contentHash: contentHash(skill.content),
  }
}

export async function syncRemoteSkills(): Promise<{
  installed: number
  updated: number
  skipped: number
}> {
  const result = { installed: 0, updated: 0, skipped: 0 }
  const catalog = await fetchRemoteCatalog()
  if (!catalog) return result

  const manifest = await loadManifest()

  for (const remoteSkill of catalog.skills) {
    const localContent = await readSkillContent(remoteSkill.id)
    const localRecord: ManagedSkillRecord | undefined =
      manifest.skills[remoteSkill.id]

    if (!localContent) {
      await installSkill(remoteSkill, manifest)
      result.installed++
      continue
    }

    if (!localRecord) {
      // Skill exists locally but isn't tracked — treat as user-managed
      result.skipped++
      continue
    }

    if (localRecord.version === remoteSkill.version) {
      continue
    }

    if (isSkillCustomized(remoteSkill.id, localContent, manifest)) {
      result.skipped++
      continue
    }

    await installSkill(remoteSkill, manifest)
    result.updated++
  }

  manifest.lastSyncedAt = new Date().toISOString()
  await saveManifest(manifest)

  return result
}

export async function seedFromRemote(): Promise<boolean> {
  const catalog = await fetchRemoteCatalog()
  if (!catalog || catalog.skills.length === 0) return false

  const manifest = await loadManifest()
  let seeded = 0

  for (const skill of catalog.skills) {
    try {
      await writeSkillFile(skill.id, skill.content)
      manifest.skills[skill.id] = {
        version: skill.version,
        contentHash: contentHash(skill.content),
      }
      seeded++
    } catch (err) {
      logger.warn('Failed to seed remote skill', {
        id: skill.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (seeded > 0) {
    manifest.lastSyncedAt = new Date().toISOString()
    await saveManifest(manifest)
    logger.info(`Seeded ${seeded} skills from remote catalog`)
  }

  return seeded > 0
}

export function startSkillSync(): void {
  if (syncTimer) return

  syncTimer = setInterval(async () => {
    try {
      const { installed, updated, skipped } = await syncRemoteSkills()
      if (installed > 0 || updated > 0) {
        logger.info('Remote skill sync completed', {
          installed,
          updated,
          skipped,
        })
      }
    } catch (err) {
      logger.warn('Skill sync failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, TIMEOUTS.SKILLS_SYNC_INTERVAL)

  // Don't block process exit
  syncTimer.unref()
}

export function stopSkillSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
