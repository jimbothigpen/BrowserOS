import { afterEach, beforeEach, describe, it, mock, spyOn } from 'bun:test'
import assert from 'node:assert'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RemoteSkillCatalog, SkillManifest } from '../../src/skills/types'

let testDir: string

const mockGetSkillsDir = mock(() => testDir)

mock.module('../../src/lib/browseros-dir', () => ({
  getSkillsDir: mockGetSkillsDir,
}))

const { loadManifest, fetchRemoteCatalog, syncRemoteSkills, seedFromRemote } =
  await import('../../src/skills/remote-sync')

function makeCatalog(
  skills: { id: string; version: string; content: string }[],
): RemoteSkillCatalog {
  return { version: 1, skills }
}

const SKILL_CONTENT = `---
name: test-skill
description: A test skill
metadata:
  display-name: Test Skill
  enabled: "true"
  version: "1.0"
---

# Test Skill

Do the thing.
`

const SKILL_CONTENT_V2 = `---
name: test-skill
description: A test skill (updated)
metadata:
  display-name: Test Skill
  enabled: "true"
  version: "2.0"
---

# Test Skill v2

Do the thing better.
`

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'skill-sync-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
  mock.restore()
})

describe('loadManifest', () => {
  it('returns empty manifest when file does not exist', async () => {
    const manifest = await loadManifest()
    assert.deepStrictEqual(manifest, { lastSyncedAt: '', skills: {} })
  })

  it('reads existing manifest', async () => {
    const manifest: SkillManifest = {
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      skills: {
        'test-skill': { version: '1.0', contentHash: 'abc123' },
      },
    }
    await writeFile(
      join(testDir, '.remote-manifest.json'),
      JSON.stringify(manifest),
    )
    const loaded = await loadManifest()
    assert.deepStrictEqual(loaded, manifest)
  })
})

describe('fetchRemoteCatalog', () => {
  it('returns null on network failure', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('network error'),
    )
    const result = await fetchRemoteCatalog()
    assert.strictEqual(result, null)
    fetchSpy.mockRestore()
  })

  it('returns null on non-ok response', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )
    const result = await fetchRemoteCatalog()
    assert.strictEqual(result, null)
    fetchSpy.mockRestore()
  })

  it('returns catalog on success', async () => {
    const catalog = makeCatalog([
      { id: 'test', version: '1.0', content: 'hello' },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await fetchRemoteCatalog()
    assert.deepStrictEqual(result, catalog)
    fetchSpy.mockRestore()
  })
})

describe('syncRemoteSkills', () => {
  it('returns zeros when remote is unavailable', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('offline'),
    )
    const result = await syncRemoteSkills()
    assert.deepStrictEqual(result, { installed: 0, updated: 0, skipped: 0 })
    fetchSpy.mockRestore()
  })

  it('installs new skills that do not exist locally', async () => {
    const catalog = makeCatalog([
      { id: 'new-skill', version: '1.0', content: SKILL_CONTENT },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await syncRemoteSkills()
    assert.strictEqual(result.installed, 1)

    const content = await readFile(
      join(testDir, 'new-skill', 'SKILL.md'),
      'utf-8',
    )
    assert.strictEqual(content, SKILL_CONTENT)

    const manifest = await loadManifest()
    assert.ok(manifest.skills['new-skill'])
    assert.strictEqual(manifest.skills['new-skill'].version, '1.0')

    fetchSpy.mockRestore()
  })

  it('updates managed skills when version changes and content is unmodified', async () => {
    // Set up existing skill and manifest
    await mkdir(join(testDir, 'test-skill'), { recursive: true })
    await writeFile(join(testDir, 'test-skill', 'SKILL.md'), SKILL_CONTENT)

    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(SKILL_CONTENT).digest('hex')
    const manifest: SkillManifest = {
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      skills: {
        'test-skill': { version: '1.0', contentHash: hash },
      },
    }
    await writeFile(
      join(testDir, '.remote-manifest.json'),
      JSON.stringify(manifest),
    )

    const catalog = makeCatalog([
      { id: 'test-skill', version: '2.0', content: SKILL_CONTENT_V2 },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await syncRemoteSkills()
    assert.strictEqual(result.updated, 1)
    assert.strictEqual(result.skipped, 0)

    const content = await readFile(
      join(testDir, 'test-skill', 'SKILL.md'),
      'utf-8',
    )
    assert.strictEqual(content, SKILL_CONTENT_V2)

    fetchSpy.mockRestore()
  })

  it('skips user-customized skills', async () => {
    await mkdir(join(testDir, 'test-skill'), { recursive: true })
    const customContent = SKILL_CONTENT + '\n\n## My Custom Section\n'
    await writeFile(join(testDir, 'test-skill', 'SKILL.md'), customContent)

    const { createHash } = await import('node:crypto')
    const originalHash = createHash('sha256')
      .update(SKILL_CONTENT)
      .digest('hex')
    const manifest: SkillManifest = {
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      skills: {
        'test-skill': { version: '1.0', contentHash: originalHash },
      },
    }
    await writeFile(
      join(testDir, '.remote-manifest.json'),
      JSON.stringify(manifest),
    )

    const catalog = makeCatalog([
      { id: 'test-skill', version: '2.0', content: SKILL_CONTENT_V2 },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await syncRemoteSkills()
    assert.strictEqual(result.skipped, 1)
    assert.strictEqual(result.updated, 0)

    // Content should remain the user's customized version
    const content = await readFile(
      join(testDir, 'test-skill', 'SKILL.md'),
      'utf-8',
    )
    assert.strictEqual(content, customContent)

    fetchSpy.mockRestore()
  })

  it('skips locally existing skills not in manifest (untracked)', async () => {
    await mkdir(join(testDir, 'my-skill'), { recursive: true })
    await writeFile(join(testDir, 'my-skill', 'SKILL.md'), SKILL_CONTENT)
    // No manifest entry for my-skill

    const catalog = makeCatalog([
      { id: 'my-skill', version: '2.0', content: SKILL_CONTENT_V2 },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await syncRemoteSkills()
    assert.strictEqual(result.skipped, 1)
    assert.strictEqual(result.updated, 0)

    fetchSpy.mockRestore()
  })

  it('does not update when versions match', async () => {
    await mkdir(join(testDir, 'test-skill'), { recursive: true })
    await writeFile(join(testDir, 'test-skill', 'SKILL.md'), SKILL_CONTENT)

    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(SKILL_CONTENT).digest('hex')
    const manifest: SkillManifest = {
      lastSyncedAt: '2025-01-01T00:00:00.000Z',
      skills: {
        'test-skill': { version: '1.0', contentHash: hash },
      },
    }
    await writeFile(
      join(testDir, '.remote-manifest.json'),
      JSON.stringify(manifest),
    )

    const catalog = makeCatalog([
      { id: 'test-skill', version: '1.0', content: SKILL_CONTENT },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await syncRemoteSkills()
    assert.strictEqual(result.installed, 0)
    assert.strictEqual(result.updated, 0)
    assert.strictEqual(result.skipped, 0)

    fetchSpy.mockRestore()
  })
})

describe('seedFromRemote', () => {
  it('returns false when remote is unavailable', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('offline'),
    )
    const result = await seedFromRemote()
    assert.strictEqual(result, false)
    fetchSpy.mockRestore()
  })

  it('seeds all skills from remote and writes manifest', async () => {
    const catalog = makeCatalog([
      { id: 'skill-a', version: '1.0', content: SKILL_CONTENT },
      { id: 'skill-b', version: '1.0', content: SKILL_CONTENT_V2 },
    ])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await seedFromRemote()
    assert.strictEqual(result, true)

    const contentA = await readFile(
      join(testDir, 'skill-a', 'SKILL.md'),
      'utf-8',
    )
    assert.strictEqual(contentA, SKILL_CONTENT)

    const manifest = await loadManifest()
    assert.ok(manifest.skills['skill-a'])
    assert.ok(manifest.skills['skill-b'])
    assert.ok(manifest.lastSyncedAt)

    fetchSpy.mockRestore()
  })

  it('returns false for empty catalog', async () => {
    const catalog = makeCatalog([])
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )

    const result = await seedFromRemote()
    assert.strictEqual(result, false)

    fetchSpy.mockRestore()
  })
})
