/**
 * @license
 * Copyright 2025 BrowserOS
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  BROWSEROS_OPENCLAW_PODMAN_MACHINE_NAME,
  configurePodmanRuntime,
  getPodmanRuntime,
  PodmanRuntime,
  resolveBundledPodmanPath,
} from '../../../../src/api/services/openclaw/podman-runtime'

function createStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function createSpawnResult(options?: {
  stdout?: string
  stderr?: string
  exitCode?: number
}) {
  return {
    stdout: options?.stdout === undefined ? null : createStream(options.stdout),
    stderr: options?.stderr === undefined ? null : createStream(options.stderr),
    exited: Promise.resolve(options?.exitCode ?? 0),
    kill() {},
  } as ReturnType<typeof Bun.spawn>
}

describe('podman runtime', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browseros-podman-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    configurePodmanRuntime({ podmanPath: 'podman' })
    mock.restore()
    mock.clearAllMocks()
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

  it('selects the configured machine by name from machine list output', async () => {
    const spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      createSpawnResult({
        stdout: JSON.stringify([
          { Name: 'podman-machine-default', Running: true },
          {
            Name: BROWSEROS_OPENCLAW_PODMAN_MACHINE_NAME,
            Running: false,
            LastUp: '',
          },
        ]),
      }),
    )
    const runtime = new PodmanRuntime({
      podmanPath: 'podman',
      machineName: BROWSEROS_OPENCLAW_PODMAN_MACHINE_NAME,
      platform: 'darwin',
    })

    expect(await runtime.getMachineStatus()).toEqual({
      initialized: true,
      running: false,
    })
    expect(spawnSpy).toHaveBeenCalledWith(
      ['podman', 'machine', 'list', '--format', 'json'],
      { stdout: 'pipe', stderr: 'ignore' },
    )
  })

  it('reports uninitialized when the configured machine is absent', async () => {
    spyOn(Bun, 'spawn').mockReturnValue(
      createSpawnResult({
        stdout: JSON.stringify([
          { Name: 'podman-machine-default', Running: true },
        ]),
      }),
    )
    const runtime = new PodmanRuntime({
      podmanPath: 'podman',
      machineName: BROWSEROS_OPENCLAW_PODMAN_MACHINE_NAME,
      platform: 'win32',
    })

    expect(await runtime.getMachineStatus()).toEqual({
      initialized: false,
      running: false,
    })
  })

  it('targets the configured machine for init, start, and stop', async () => {
    const spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(createSpawnResult())
    const runtime = new PodmanRuntime({
      podmanPath: 'podman',
      machineName: 'browseros-openclaw-custom',
      platform: 'darwin',
    })

    await runtime.initMachine()
    await runtime.startMachine()
    await runtime.stopMachine()

    expect(spawnSpy).toHaveBeenNthCalledWith(
      1,
      [
        'podman',
        'machine',
        'init',
        '--cpus',
        '8',
        '--memory',
        '8096',
        '--disk-size',
        '10',
        'browseros-openclaw-custom',
      ],
      {
        stdout: 'ignore',
        stderr: 'pipe',
      },
    )
    expect(spawnSpy).toHaveBeenNthCalledWith(
      2,
      ['podman', 'machine', 'start', 'browseros-openclaw-custom'],
      {
        stdout: 'ignore',
        stderr: 'pipe',
      },
    )
    expect(spawnSpy).toHaveBeenNthCalledWith(
      3,
      ['podman', 'machine', 'stop', 'browseros-openclaw-custom'],
      {
        stdout: 'ignore',
        stderr: 'ignore',
      },
    )
  })

  it('keeps linux machine handling as a no-op native path', async () => {
    const spawnSpy = spyOn(Bun, 'spawn')
    const runtime = new PodmanRuntime({
      podmanPath: 'podman',
      machineName: BROWSEROS_OPENCLAW_PODMAN_MACHINE_NAME,
      platform: 'linux',
    })

    expect(await runtime.getMachineStatus()).toEqual({
      initialized: true,
      running: true,
    })

    await runtime.initMachine()
    await runtime.startMachine()
    await runtime.stopMachine()

    expect(spawnSpy).not.toHaveBeenCalled()
  })
})
