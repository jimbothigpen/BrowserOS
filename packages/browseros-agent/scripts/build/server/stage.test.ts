import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadManifest } from './manifest'

describe('server artifact staging', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('loads empty local-resource rules from the manifest', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
    const manifestPath = join(tempDir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ resources: [] }))

    expect(loadManifest(manifestPath)).toEqual({
      resources: [],
    })
  })
})
