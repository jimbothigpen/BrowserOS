/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { createServer } from 'node:net'
import { OPENCLAW_GATEWAY_CONTAINER_NAME } from '@browseros/shared/constants/openclaw'
import { ContainerRuntime } from '../../../../src/api/services/openclaw/container-runtime'

const PROJECT_DIR = '/tmp/openclaw'
const defaultSpec = {
  image: 'ghcr.io/openclaw/openclaw:2026.4.12',
  port: 18789,
  hostHome: '/tmp/openclaw',
  envFilePath: '/tmp/openclaw/.openclaw/.env',
  gatewayToken: 'token-123',
  timezone: 'America/Los_Angeles',
}

type InspectCaptureResult = {
  code: number
  stdout: string
  stderr: string
}

function createRuntime(
  runCommand: (
    args: string[],
    options?: { cwd?: string; onOutput?: (line: string) => void },
  ) => Promise<number>,
  listRunningContainers: () => Promise<string[]> = async () => [],
  stopMachine: () => Promise<void> = async () => {},
  captureCommand?: (
    args: string[],
    options?: { cwd?: string },
  ) => Promise<InspectCaptureResult>,
): ContainerRuntime {
  return new ContainerRuntime(
    {
      ensureReady: async () => {},
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: true }),
      runCommand,
      tailContainerLogs: () => () => {},
      listRunningContainers,
      stopMachine,
    } as never,
    PROJECT_DIR,
    captureCommand
      ? ({
          capturePodmanCommand: captureCommand,
        } as never)
      : undefined,
  )
}

function expectedGatewayRuntimeArgs(spec: typeof defaultSpec): string[] {
  return [
    '--env-file',
    spec.envFilePath,
    '-e',
    'HOME=/home/node',
    '-e',
    'OPENCLAW_HOME=/home/node',
    '-e',
    'OPENCLAW_STATE_DIR=/home/node/.openclaw',
    '-e',
    'OPENCLAW_NO_RESPAWN=1',
    '-e',
    'NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache',
    '-e',
    'NODE_ENV=production',
    '-e',
    `TZ=${spec.timezone}`,
    '-v',
    `${spec.hostHome}:/home/node`,
    '--add-host',
    'host.containers.internal:host-gateway',
    '-e',
    `OPENCLAW_GATEWAY_TOKEN=${spec.gatewayToken}`,
  ]
}

function expectedStartGatewayRunArgs(spec: typeof defaultSpec): string[] {
  return [
    'run',
    '-d',
    '--name',
    OPENCLAW_GATEWAY_CONTAINER_NAME,
    '--restart',
    'unless-stopped',
    '-p',
    `127.0.0.1:${spec.port}:18789`,
    ...expectedGatewayRuntimeArgs(spec),
    '--health-cmd',
    'curl -sf http://127.0.0.1:18789/healthz',
    '--health-interval',
    '30s',
    '--health-timeout',
    '10s',
    '--health-retries',
    '3',
    spec.image,
    'node',
    'dist/index.js',
    'gateway',
    '--bind',
    'lan',
    '--port',
    '18789',
    '--allow-unconfigured',
  ]
}

async function withOccupiedPort<T>(
  port: number,
  run: () => Promise<T>,
): Promise<T> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })

  try {
    return await run()
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('ContainerRuntime', () => {
  it('pullImage runs podman pull for the requested image', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.pullImage('ghcr.io/openclaw/openclaw:2026.4.12')

    expect(calls).toEqual([
      {
        args: ['pull', 'ghcr.io/openclaw/openclaw:2026.4.12'],
        cwd: PROJECT_DIR,
      },
    ])
  })

  it('startGateway removes any existing gateway and runs a fresh container', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.startGateway(defaultSpec)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      cwd: PROJECT_DIR,
      args: ['rm', '-f', '--ignore', OPENCLAW_GATEWAY_CONTAINER_NAME],
    })
    expect(calls[1]).toEqual({
      cwd: PROJECT_DIR,
      args: expectedStartGatewayRunArgs(defaultSpec),
    })
  })

  it('startGateway chooses a free host port when the preferred port is occupied', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await withOccupiedPort(defaultSpec.port, async () => {
      const chosenPort = await (
        runtime as unknown as {
          startGateway: typeof runtime.startGateway
        }
      ).startGateway(defaultSpec)

      expect(chosenPort).toBeGreaterThan(0)
      expect(chosenPort).not.toBe(defaultSpec.port)
      expect(calls[1]?.args).toContain(`127.0.0.1:${chosenPort}:18789`)
    })
  })

  it('inspectGateway reports container state and mapped host port', async () => {
    const runtime = createRuntime(
      async () => 0,
      async () => [],
      async () => {},
      async () => ({
        code: 0,
        stdout: JSON.stringify([
          {
            State: { Running: true },
            NetworkSettings: {
              Ports: {
                '18789/tcp': [
                  {
                    HostIp: '127.0.0.1',
                    HostPort: '43210',
                  },
                ],
              },
            },
          },
        ]),
        stderr: 'warning: harmless stderr output',
      }),
    )

    const result = await (
      runtime as unknown as {
        inspectGateway: typeof runtime.inspectGateway
      }
    ).inspectGateway()

    expect(result).toEqual({
      exists: true,
      running: true,
      hostPort: 43210,
    })
  })

  it('inspectGateway reports an absent container when podman inspect says it is missing', async () => {
    const runtime = createRuntime(
      async () => 0,
      async () => [],
      async () => {},
      async () => ({
        code: 1,
        stdout: '',
        stderr: `Error: no such object: ${OPENCLAW_GATEWAY_CONTAINER_NAME}`,
      }),
    )

    const result = await (
      runtime as unknown as {
        inspectGateway: typeof runtime.inspectGateway
      }
    ).inspectGateway()

    expect(result).toEqual({
      exists: false,
      running: false,
      hostPort: null,
    })
  })

  it('inspectGateway falls back to HostConfig PortBindings for the host port', async () => {
    const runtime = createRuntime(
      async () => 0,
      async () => [],
      async () => {},
      async () => ({
        code: 0,
        stdout: JSON.stringify([
          {
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: {},
            },
            HostConfig: {
              PortBindings: {
                '18789/tcp': [
                  {
                    HostIp: '127.0.0.1',
                    HostPort: '54321',
                  },
                ],
              },
            },
          },
        ]),
        stderr: '',
      }),
    )

    const result = await (
      runtime as unknown as {
        inspectGateway: typeof runtime.inspectGateway
      }
    ).inspectGateway()

    expect(result).toEqual({
      exists: true,
      running: true,
      hostPort: 54321,
    })
  })

  it('startGateway retries with a different host port when podman reports a bind conflict', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    let runAttempts = 0
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      if (args[0] === 'run') {
        runAttempts += 1
        if (runAttempts === 1) {
          options?.onOutput?.(
            'Error: unable to bind 127.0.0.1:18789: address already in use',
          )
          return 1
        }
      }
      return 0
    })

    const chosenPort = await runtime.startGateway(defaultSpec)

    const runCalls = calls.filter((call) => call.args[0] === 'run')
    expect(runCalls).toHaveLength(2)
    expect(runCalls[0].args).toContain(`127.0.0.1:${defaultSpec.port}:18789`)
    expect(runCalls[1].args).not.toContain(
      `127.0.0.1:${defaultSpec.port}:18789`,
    )
    expect(chosenPort).toBeGreaterThan(0)
  })

  it('runGatewaySetupCommand in direct mode builds a one-off podman run command', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.runGatewaySetupCommand(
      ['node', 'dist/index.js', 'agents', 'list', '--json'],
      defaultSpec,
    )

    expect(calls).toEqual([
      {
        cwd: PROJECT_DIR,
        args: [
          'rm',
          '-f',
          '--ignore',
          `${OPENCLAW_GATEWAY_CONTAINER_NAME}-setup`,
        ],
      },
      {
        cwd: PROJECT_DIR,
        args: [
          'run',
          '--rm',
          '--name',
          `${OPENCLAW_GATEWAY_CONTAINER_NAME}-setup`,
          ...expectedGatewayRuntimeArgs(defaultSpec),
          defaultSpec.image,
          'node',
          'dist/index.js',
          'agents',
          'list',
          '--json',
        ],
      },
    ])
  })

  it('stopGateway removes the direct runtime container', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.stopGateway()

    expect(calls).toEqual([
      {
        cwd: PROJECT_DIR,
        args: ['rm', '-f', '--ignore', OPENCLAW_GATEWAY_CONTAINER_NAME],
      },
    ])
  })

  it('stopGateway is idempotent when the managed container is already absent', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      options?.onOutput?.(
        `Error: no container with name "${OPENCLAW_GATEWAY_CONTAINER_NAME}" found`,
      )
      return 0
    })

    await expect(runtime.stopGateway()).resolves.toBeUndefined()
    expect(calls).toEqual([
      {
        cwd: PROJECT_DIR,
        args: ['rm', '-f', '--ignore', OPENCLAW_GATEWAY_CONTAINER_NAME],
      },
    ])
  })

  it('getGatewayLogs tails logs from the direct runtime container', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      options?.onOutput?.('first')
      options?.onOutput?.('second')
      return 0
    })

    const logs = await runtime.getGatewayLogs(25)

    expect(logs).toEqual(['first', 'second'])
    expect(calls).toEqual([
      {
        cwd: PROJECT_DIR,
        args: ['logs', '--tail', '25', OPENCLAW_GATEWAY_CONTAINER_NAME],
      },
    ])
  })

  it('restartGateway recreates and launches the direct runtime container', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.restartGateway(defaultSpec)

    expect(calls).toEqual([
      {
        cwd: PROJECT_DIR,
        args: ['rm', '-f', '--ignore', OPENCLAW_GATEWAY_CONTAINER_NAME],
      },
      {
        cwd: PROJECT_DIR,
        args: expectedStartGatewayRunArgs(defaultSpec),
      },
    ])
  })

  it('stopMachineIfSafe allows the managed gateway container', async () => {
    let stopCalls = 0
    const runtime = createRuntime(
      async () => 0,
      async () => [OPENCLAW_GATEWAY_CONTAINER_NAME],
      async () => {
        stopCalls += 1
      },
    )

    await runtime.stopMachineIfSafe()

    expect(stopCalls).toBe(1)
  })

  it('stopMachineIfSafe does not stop machine if non-BrowserOS containers are running', async () => {
    let stopCalls = 0
    const runtime = createRuntime(
      async () => 0,
      async () => [OPENCLAW_GATEWAY_CONTAINER_NAME, 'postgres-dev'],
      async () => {
        stopCalls += 1
      },
    )

    await runtime.stopMachineIfSafe()

    expect(stopCalls).toBe(0)
  })

  it('execInContainer targets the shared gateway container name', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = createRuntime(async (args, options) => {
      calls.push({ args, cwd: options?.cwd })
      return 0
    })

    await runtime.execInContainer(['node', '--version'])

    expect(calls).toEqual([
      {
        cwd: undefined,
        args: ['exec', OPENCLAW_GATEWAY_CONTAINER_NAME, 'node', '--version'],
      },
    ])
  })

  it('tailGatewayLogs targets the shared gateway container name', () => {
    const names: string[] = []
    const runtime = new ContainerRuntime(
      {
        ensureReady: async () => {},
        isPodmanAvailable: async () => true,
        getMachineStatus: async () => ({ initialized: true, running: true }),
        runCommand: async () => 0,
        tailContainerLogs: (containerName: string) => {
          names.push(containerName)
          return () => {}
        },
        listRunningContainers: async () => [],
        stopMachine: async () => {},
      } as never,
      PROJECT_DIR,
    )

    const stop = runtime.tailGatewayLogs(() => {})
    stop()

    expect(names).toEqual([OPENCLAW_GATEWAY_CONTAINER_NAME])
  })
})
