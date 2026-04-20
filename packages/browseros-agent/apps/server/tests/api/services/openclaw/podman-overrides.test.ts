/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  getPodmanOverridesPath,
  loadPodmanOverrides,
  savePodmanOverrides,
} from '../../../../src/api/services/openclaw/podman-overrides'

describe('podman overrides', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browseros-podman-ovr-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns null podmanPath when the overrides file is missing', async () => {
    expect(await loadPodmanOverrides(tempDir)).toEqual({ podmanPath: null })
  })

  it('round-trips save and load', async () => {
    await savePodmanOverrides(tempDir, {
      podmanPath: '/opt/homebrew/bin/podman',
    })
    expect(await loadPodmanOverrides(tempDir)).toEqual({
      podmanPath: '/opt/homebrew/bin/podman',
    })
  })

  it('returns null when the overrides file is malformed JSON', async () => {
    fs.writeFileSync(getPodmanOverridesPath(tempDir), '{not json')
    expect(await loadPodmanOverrides(tempDir)).toEqual({ podmanPath: null })
  })

  it('treats empty string and wrong types as null', async () => {
    fs.writeFileSync(
      getPodmanOverridesPath(tempDir),
      JSON.stringify({ podmanPath: '' }),
    )
    expect(await loadPodmanOverrides(tempDir)).toEqual({ podmanPath: null })

    fs.writeFileSync(
      getPodmanOverridesPath(tempDir),
      JSON.stringify({ podmanPath: 42 }),
    )
    expect(await loadPodmanOverrides(tempDir)).toEqual({ podmanPath: null })
  })

  it('persists an explicit null', async () => {
    await savePodmanOverrides(tempDir, { podmanPath: null })
    expect(await loadPodmanOverrides(tempDir)).toEqual({ podmanPath: null })
    expect(fs.existsSync(getPodmanOverridesPath(tempDir))).toBe(true)
  })

  it('creates the openclaw directory if it does not exist', async () => {
    const nested = path.join(tempDir, 'does-not-exist')
    await savePodmanOverrides(nested, { podmanPath: '/usr/local/bin/podman' })
    expect(fs.existsSync(getPodmanOverridesPath(nested))).toBe(true)
  })
})
