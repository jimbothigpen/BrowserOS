/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  configurePodmanRuntime,
  getPodmanRuntime,
  resolveBundledPodmanPath,
} from '../../../../src/api/services/openclaw/podman-runtime'

describe('podman runtime', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browseros-podman-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    configurePodmanRuntime({ podmanPath: 'podman' })
  })

  it('returns the bundled podman path when the executable exists', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    expect(resolveBundledPodmanPath(tempDir, 'darwin')).toBe(bundledPath)
  })

  it('uses the windows executable name for bundled podman', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman.exe',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    expect(resolveBundledPodmanPath(tempDir, 'win32')).toBe(bundledPath)
  })

  it('returns null when no bundled podman executable exists', () => {
    expect(resolveBundledPodmanPath(tempDir, 'darwin')).toBeNull()
  })

  it('configures the runtime to prefer the bundled podman path', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    const runtime = configurePodmanRuntime({ resourcesDir: tempDir })

    expect(runtime.getPodmanPath()).toBe(bundledPath)
    expect(getPodmanRuntime().getPodmanPath()).toBe(bundledPath)
  })

  it('falls back to PATH podman when no bundled executable is present', () => {
    const runtime = configurePodmanRuntime({ resourcesDir: tempDir })

    expect(runtime.getPodmanPath()).toBe('podman')
  })
})
