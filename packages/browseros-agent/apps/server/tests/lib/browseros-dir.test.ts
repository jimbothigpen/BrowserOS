/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('browseros agent paths', () => {
  let homeDir = ''

  mock.module('node:os', () => ({
    homedir: () => homeDir,
  }))

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'browseros-home-'))
  })

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true })
    mock.restore()
  })

  it('resolves the shared agent directory structure', async () => {
    const {
      getAgentDir,
      getAgentMetadataPath,
      getAgentRuntimeDir,
      getAgentsDir,
    } = await import('../../src/lib/browseros-dir')
    const baseDir = join(homeDir, '.browseros')

    expect(getAgentsDir()).toBe(join(baseDir, 'agents'))
    expect(getAgentDir('chief-of-staff')).toBe(
      join(baseDir, 'agents', 'chief-of-staff'),
    )
    expect(getAgentMetadataPath('chief-of-staff')).toBe(
      join(baseDir, 'agents', 'chief-of-staff', 'agent.json'),
    )
    expect(getAgentRuntimeDir('chief-of-staff')).toBe(
      join(baseDir, 'agents', 'chief-of-staff', 'runtime'),
    )
  })

  it('creates the agents directory when ensuring the browseros directory', async () => {
    const { ensureBrowserosDir } = await import('../../src/lib/browseros-dir')
    await ensureBrowserosDir()

    expect(existsSync(join(homeDir, '.browseros', 'agents'))).toBe(true)
  })
})
