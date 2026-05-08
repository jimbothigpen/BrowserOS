/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OPENCLAW_GATEWAY_CONTAINER_NAME,
  OPENCLAW_GATEWAY_CONTAINER_PORT,
} from '../../../../../../packages/shared/src/constants/openclaw'
import {
  configureOpenClawRuntime,
  getAgentRuntimeRegistry,
  getOpenClawRuntime,
  OpenClawContainerRuntime,
  resetAgentRuntimeRegistry,
} from '../../../../src/lib/agents/runtime'
import type {
  ManagedContainerDeps,
  MountRoot,
} from '../../../../src/lib/container/managed'
import type {
  ContainerInfo,
  ContainerSpec,
} from '../../../../src/lib/container/types'

interface FakeCli {
  inspectContainer: (name: string) => Promise<ContainerInfo | null>
  removeContainer: (name: string, opts?: { force?: boolean }) => Promise<void>
  waitForContainerNameRelease: () => Promise<void>
  createContainer: (spec: ContainerSpec) => Promise<void>
  startContainer: (name: string) => Promise<void>
  waitForContainerRunning: (name: string) => Promise<void>
  exec: (name: string, cmd: string[]) => Promise<number>
}

function makeDeps(opts: { lockDir: string }): {
  deps: ManagedContainerDeps
  getCapturedSpec: () => ContainerSpec | null
} {
  let capturedSpec: ContainerSpec | null = null
  const fakeCli = {
    inspectContainer: async (): Promise<ContainerInfo | null> => ({
      id: 'cid',
      name: OPENCLAW_GATEWAY_CONTAINER_NAME,
      image: 'docker.io/openclaw:latest',
      status: 'running',
      running: true,
    }),
    removeContainer: async () => {},
    waitForContainerNameRelease: async () => {},
    createContainer: async (spec: ContainerSpec) => {
      capturedSpec = spec
    },
    startContainer: async () => {},
    waitForContainerRunning: async () => {},
    exec: async () => 0,
  } satisfies FakeCli
  const fakeLoader = { ensureImageLoaded: async () => {} }
  const fakeVm = {
    ensureReady: async () => {},
    getDefaultGateway: async () => '192.168.5.2',
    isReady: async () => true,
    stopVm: async () => {},
  }
  const deps: ManagedContainerDeps = {
    cli: fakeCli as unknown as ManagedContainerDeps['cli'],
    loader: fakeLoader as unknown as ManagedContainerDeps['loader'],
    vm: fakeVm as unknown as ManagedContainerDeps['vm'],
    limactlPath: '/opt/homebrew/bin/limactl',
    limaHome: '/Users/dev/.browseros/lima',
    vmName: 'browseros-vm',
    lockDir: opts.lockDir,
  }
  return { deps, getCapturedSpec: () => capturedSpec }
}

describe('OpenClawContainerRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
    resetAgentRuntimeRegistry()
  })

  function mkTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-runtime-test-'))
    tempDirs.push(dir)
    return dir
  }

  class TestRuntime extends OpenClawContainerRuntime {
    // Override the live HTTP probe so tests don't need a real server.
    protected override async readinessProbe(): Promise<boolean> {
      return true
    }
  }

  function makeRuntime() {
    const lockDir = mkTempDir()
    const browserosDir = '/host/browseros'
    const { deps, getCapturedSpec } = makeDeps({ lockDir })
    const runtime = new TestRuntime(deps, {
      browserosDir,
      openclawDir: `${browserosDir}/vm/openclaw`,
    })
    return { runtime, getCapturedSpec, browserosDir }
  }

  it('declares the canonical OpenClaw runtime descriptor', () => {
    const { runtime } = makeRuntime()
    expect(runtime.descriptor.adapterId).toBe('openclaw')
    expect(runtime.descriptor.kind).toBe('container')
    expect(runtime.descriptor.containerName).toBe(
      OPENCLAW_GATEWAY_CONTAINER_NAME,
    )
    expect(runtime.descriptor.platforms).toContain('darwin')
  })

  it('mountRoots maps the openclaw state dir to the gateway container home', () => {
    const { runtime } = makeRuntime()
    const mounts: readonly MountRoot[] = (
      runtime as unknown as { mountRoots(): readonly MountRoot[] }
    ).mountRoots()
    expect(mounts).toEqual([
      {
        hostPath: '/host/browseros/vm/openclaw',
        containerPath: '/home/node',
        kind: 'shared',
      },
    ])
  })

  it('setHostPort updates the port referenced by buildContainerSpec', async () => {
    const { runtime, getCapturedSpec } = makeRuntime()
    runtime.setHostPort(41091)
    await runtime.start()
    const spec = getCapturedSpec()
    if (!spec) throw new Error('createContainer was never called')
    expect(spec.ports).toEqual([
      {
        hostIp: '127.0.0.1',
        hostPort: 41091,
        containerPort: OPENCLAW_GATEWAY_CONTAINER_PORT,
      },
    ])
  })

  it('builds the gateway spec with sleep-free entrypoint, mount, host-gateway, and command', async () => {
    const { runtime, getCapturedSpec } = makeRuntime()
    await runtime.start()
    const spec = getCapturedSpec()
    if (!spec) throw new Error('createContainer was never called')
    expect(spec.command?.[0]).toBe('node')
    expect(spec.command).toEqual(
      expect.arrayContaining([
        'gateway',
        '--bind',
        'lan',
        '--allow-unconfigured',
      ]),
    )
    expect(spec.addHosts).toContain('host.containers.internal:192.168.5.2')
    expect(spec.mounts).toEqual([
      { source: '/mnt/browseros/vm/openclaw', target: '/home/node' },
    ])
    expect(spec.env?.OPENCLAW_GATEWAY_PRIVATE_INGRESS_NO_AUTH).toBe('1')
  })

  it('getAcpExecSpec composes the openclaw acp argv with optional --session', () => {
    const { runtime } = makeRuntime()
    const noSession = runtime.getAcpExecSpec({
      commandEnv: {},
      openclawSessionKey: null,
    })
    expect(noSession.argv).toEqual([
      'openclaw',
      'acp',
      '--url',
      `ws://127.0.0.1:${OPENCLAW_GATEWAY_CONTAINER_PORT}`,
    ])
    expect(noSession.env?.OPENCLAW_HIDE_BANNER).toBe('1')
    expect(noSession.env?.OPENCLAW_SUPPRESS_NOTES).toBe('1')

    const withSession = runtime.getAcpExecSpec({
      commandEnv: {},
      openclawSessionKey: 'agent:research:main',
    })
    expect(withSession.argv).toEqual(
      expect.arrayContaining(['--session', 'agent:research:main']),
    )

    const withSyntheticSession = runtime.getAcpExecSpec({
      commandEnv: {},
      openclawSessionKey: 'sidepanel:c0ffee:openclaw:default:medium',
    })
    expect(withSyntheticSession.argv).toEqual(
      expect.arrayContaining([
        '--session',
        'agent:main:sidepanel-c0ffee-openclaw-default-medium',
      ]),
    )
  })

  it('buildExecArgv produces the canonical limactl/nerdctl spawn string', () => {
    const { runtime } = makeRuntime()
    const out = runtime.buildExecArgv(
      runtime.getAcpExecSpec({
        commandEnv: {},
        openclawSessionKey: 'agent:main:main',
      }),
    )
    expect(out).toContain('LIMA_HOME=/Users/dev/.browseros/lima')
    expect(out).toContain('shell --workdir / browseros-vm --')
    expect(out).toContain('nerdctl exec -i')
    expect(out).toContain(OPENCLAW_GATEWAY_CONTAINER_NAME)
    expect(out).toContain('openclaw acp --url ws://127.0.0.1:18789')
    expect(out).toContain('-e OPENCLAW_HIDE_BANNER=1')
    expect(out).toContain('--session agent:main:main')
  })

  it('compat methods delegate to inherited base primitives', () => {
    const { runtime } = makeRuntime()
    // Just verifying these don't throw and that the names exist —
    // their semantics are exercised by the openclaw-service tests.
    expect(typeof runtime.startGateway).toBe('function')
    expect(typeof runtime.stopGateway).toBe('function')
    expect(typeof runtime.restartGateway).toBe('function')
    expect(typeof runtime.prewarmGatewayImage).toBe('function')
    expect(typeof runtime.getGatewayLogs).toBe('function')
    expect(typeof runtime.tailGatewayLogs).toBe('function')
    expect(typeof runtime.isGatewayCurrent).toBe('function')
    expect(typeof runtime.runGatewaySetupCommand).toBe('function')
  })

  describe('configureOpenClawRuntime', () => {
    let originalPlatform: string
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('returns null on non-darwin and skips registration', () => {
      originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })
      expect(configureOpenClawRuntime()).toBeNull()
      expect(getOpenClawRuntime()).toBeNull()
    })

    it('registers on darwin and is idempotent across repeat calls', () => {
      originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const browserosDir = mkTempDir()
      const first = configureOpenClawRuntime({ browserosDir })
      const second = configureOpenClawRuntime({ browserosDir })
      expect(first).toBeInstanceOf(OpenClawContainerRuntime)
      expect(second).toBe(first)
      expect(getAgentRuntimeRegistry().get('openclaw')).toBe(first)
    })
  })
})
