/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { ContainerRuntime } from '../../../../src/api/services/openclaw/container-runtime'

describe('ContainerRuntime', () => {
  it('pullImage runs podman pull for the requested image', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = new ContainerRuntime(
      {
        ensureReady: async () => {},
        isPodmanAvailable: async () => true,
        getMachineStatus: async () => ({ initialized: true, running: true }),
        runCommand: async (args, options) => {
          calls.push({ args, cwd: options?.cwd })
          return 0
        },
        tailContainerLogs: () => () => {},
        listRunningContainers: async () => [],
        stopMachine: async () => {},
      } as never,
      '/tmp/openclaw',
    )

    await runtime.pullImage('ghcr.io/openclaw/openclaw:2026.4.12')

    expect(calls).toEqual([
      {
        args: ['pull', 'ghcr.io/openclaw/openclaw:2026.4.12'],
        cwd: '/tmp/openclaw',
      },
    ])
  })

  it('startGateway removes any existing gateway and runs a fresh container', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = new ContainerRuntime(
      {
        runCommand: async (args, options) => {
          calls.push({ args, cwd: options?.cwd })
          return 0
        },
        ensureReady: async () => {},
        isPodmanAvailable: async () => true,
        getMachineStatus: async () => ({ initialized: true, running: true }),
        tailContainerLogs: () => () => {},
        listRunningContainers: async () => [],
        stopMachine: async () => {},
      } as never,
      '/tmp/openclaw',
    )

    await runtime.startGateway({
      image: 'ghcr.io/openclaw/openclaw:2026.4.12',
      port: 18789,
      hostHome: '/tmp/openclaw',
      envFilePath: '/tmp/openclaw/.openclaw/.env',
      gatewayToken: 'token-123',
      timezone: 'America/Los_Angeles',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      cwd: '/tmp/openclaw',
      args: ['rm', '-f', 'openclaw-gateway'],
    })
    expect(calls.at(-1)).toEqual({
      cwd: '/tmp/openclaw',
      args: expect.arrayContaining([
        'run',
        '-d',
        '--name',
        'openclaw-gateway',
        '--restart',
        'unless-stopped',
        '-p',
        '127.0.0.1:18789:18789',
        '--env-file',
        '/tmp/openclaw/.openclaw/.env',
        '-e',
        'OPENCLAW_GATEWAY_TOKEN=token-123',
        '-v',
        '/tmp/openclaw:/home/node',
        'ghcr.io/openclaw/openclaw:2026.4.12',
        'node',
        'dist/index.js',
        'gateway',
      ]),
    })
  })
})
