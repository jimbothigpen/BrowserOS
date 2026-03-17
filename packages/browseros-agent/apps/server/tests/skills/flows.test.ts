/**
 * Tests all four key user-facing flows for remote skill sync.
 * Runs against the live CDN at cdn.browseros.com.
 */

import { afterEach, beforeEach, describe, it, mock } from 'bun:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testDir: string

const mockGetSkillsDir = mock(() => testDir)

mock.module('../../src/lib/browseros-dir', () => ({
  getSkillsDir: mockGetSkillsDir,
}))

mock.module('../../src/env', () => ({
  INLINED_ENV: {
    SKILLS_CATALOG_URL: 'https://cdn.browseros.com/skills/v1/catalog.json',
  },
}))

const { seedFromRemote, syncRemoteSkills, loadManifest } =
  await import('../../src/skills/remote-sync')

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'flow-test-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('Flow 1: New remote skill gets auto-installed', () => {
  it('installs a skill that exists on CDN but not locally', async () => {
    // Seed all skills first
    await seedFromRemote()

    // Delete deep-research locally + remove from manifest
    await rm(join(testDir, 'deep-research'), { recursive: true })
    const manifestPath = join(testDir, '.remote-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    delete manifest.skills['deep-research']
    await writeFile(manifestPath, JSON.stringify(manifest))

    // Sync — deep-research should be re-installed as a "new" skill
    const result = await syncRemoteSkills()
    assert.strictEqual(result.installed, 1)

    const content = await readFile(
      join(testDir, 'deep-research', 'SKILL.md'),
      'utf-8',
    )
    assert.ok(content.includes('name: deep-research'))
  })
})

describe('Flow 2: User-edited default skill is never overwritten', () => {
  it('preserves user edits to a managed skill during sync', async () => {
    await seedFromRemote()

    // User edits deep-research
    const skillPath = join(testDir, 'deep-research', 'SKILL.md')
    const original = await readFile(skillPath, 'utf-8')
    const edited = original + '\n\n## My Custom Research Notes\nAlways check arxiv first.\n'
    await writeFile(skillPath, edited)

    // Fake a version bump in manifest to trigger update check
    const manifestPath = join(testDir, '.remote-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    manifest.skills['deep-research'].version = '0.1'
    await writeFile(manifestPath, JSON.stringify(manifest))

    // Sync — should skip deep-research because content hash differs
    const result = await syncRemoteSkills()
    assert.strictEqual(result.skipped >= 1, true)

    // Verify the user's edits are still there
    const afterSync = await readFile(skillPath, 'utf-8')
    assert.ok(afterSync.includes('## My Custom Research Notes'))
    assert.ok(afterSync.includes('Always check arxiv first.'))
  })
})

describe('Flow 3: User-created custom skill is never touched', () => {
  it('leaves a user-created skill completely alone during sync', async () => {
    await seedFromRemote()

    // User creates their own custom skill
    const customDir = join(testDir, 'my-custom-workflow')
    await mkdir(customDir, { recursive: true })
    const customContent = `---
name: my-custom-workflow
description: My personal workflow automation
metadata:
  display-name: My Custom Workflow
  enabled: "true"
  version: "1.0"
---

# My Custom Workflow

This is my personal skill that does things my way.
`
    await writeFile(join(customDir, 'SKILL.md'), customContent)

    // Sync — should not touch the custom skill at all
    const result = await syncRemoteSkills()

    // Custom skill still exists with exact same content
    const afterSync = await readFile(
      join(customDir, 'SKILL.md'),
      'utf-8',
    )
    assert.strictEqual(afterSync, customContent)

    // Custom skill is NOT in the manifest (we don't track it)
    const manifest = await loadManifest()
    assert.strictEqual(manifest.skills['my-custom-workflow'], undefined)
  })
})

describe('Flow 4: Updated remote skill replaces unmodified local version', () => {
  it('updates a skill when remote has newer version and user hasnt edited it', async () => {
    await seedFromRemote()

    // Verify summarize-page was installed
    const skillPath = join(testDir, 'summarize-page', 'SKILL.md')
    const original = await readFile(skillPath, 'utf-8')
    assert.ok(original.includes('name: summarize-page'))

    // Fake an older version in manifest (user hasn't edited the content)
    const manifestPath = join(testDir, '.remote-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    manifest.skills['summarize-page'].version = '0.1'
    await writeFile(manifestPath, JSON.stringify(manifest))

    // Sync — should update summarize-page since content hash still matches
    const result = await syncRemoteSkills()
    assert.strictEqual(result.updated >= 1, true)

    // Updated manifest should have the current version from CDN
    const updatedManifest = await loadManifest()
    assert.strictEqual(updatedManifest.skills['summarize-page'].version, '1.0')
  })
})
