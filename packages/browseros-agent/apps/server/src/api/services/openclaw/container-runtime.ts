/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OpenClaw container lifecycle abstraction over PodmanRuntime.
 */

import { createServer } from 'node:net'
import { OPENCLAW_GATEWAY_CONTAINER_NAME } from '@browseros/shared/constants/openclaw'
import { logger } from '../../../lib/logger'
import type { LogFn, PodmanRuntime } from './podman-runtime'

const GATEWAY_CONTAINER_HOME = '/home/node'
const GATEWAY_STATE_DIR = `${GATEWAY_CONTAINER_HOME}/.openclaw`
const GATEWAY_CONTAINER_PORT = 18789
const GATEWAY_START_MAX_ATTEMPTS = 3

export type GatewayContainerSpec = {
  image: string
  port: number
  hostHome: string
  envFilePath: string
  gatewayToken?: string
  timezone: string
}

export type GatewayInspection = {
  exists: boolean
  running: boolean
  hostPort: number | null
}

type PodmanInspectPortBinding = {
  HostIp?: string
  HostPort?: string
}

type PodmanInspectContainer = {
  State?: {
    Running?: boolean
    Status?: string
  }
  NetworkSettings?: {
    Ports?: Record<string, PodmanInspectPortBinding[] | null>
  }
  HostConfig?: {
    PortBindings?: Record<string, PodmanInspectPortBinding[] | null>
  }
}

type PodmanCommandCaptureResult = {
  code: number
  stdout: string
  stderr: string
}

type PodmanCommandCaptureFn = (
  args: string[],
  options?: {
    cwd?: string
  },
) => Promise<PodmanCommandCaptureResult>

export class ContainerRuntime {
  private readonly capturePodmanCommand: PodmanCommandCaptureFn

  constructor(
    private podman: PodmanRuntime,
    private projectDir: string,
    options?: {
      capturePodmanCommand?: PodmanCommandCaptureFn
    },
  ) {
    this.capturePodmanCommand =
      options?.capturePodmanCommand ??
      this.defaultCapturePodmanCommand.bind(this)
  }

  async ensureReady(onLog?: LogFn): Promise<void> {
    logger.info('Ensuring Podman runtime readiness')
    return this.podman.ensureReady(onLog)
  }

  async isPodmanAvailable(): Promise<boolean> {
    return this.podman.isPodmanAvailable()
  }

  async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    return this.podman.getMachineStatus()
  }

  async pullImage(image: string, onLog?: LogFn): Promise<void> {
    const code = await this.runPodmanCommand(['pull', image], onLog)
    if (code !== 0) throw new Error(`image pull failed with code ${code}`)
  }

  async startGateway(
    input: GatewayContainerSpec,
    onLog?: LogFn,
  ): Promise<number> {
    await this.ensureGatewayRemoved(onLog)
    const attemptedPorts = new Set<number>()

    for (let attempt = 1; attempt <= GATEWAY_START_MAX_ATTEMPTS; attempt++) {
      const hostPort = await this.chooseGatewayHostPort(
        input.port,
        attemptedPorts,
      )
      attemptedPorts.add(hostPort)
      const runArgs = this.buildGatewayStartArgs(input, hostPort)

      const result = await this.runPodmanCommandResult(runArgs, onLog)
      this.logPodmanCommandResult(runArgs, result)

      if (result.code === 0) {
        return hostPort
      }

      if (
        this.isGatewayBindConflict(result.output) &&
        attempt < GATEWAY_START_MAX_ATTEMPTS
      ) {
        logger.warn('OpenClaw gateway start hit a bind conflict; retrying', {
          attempt,
          hostPort,
        })
        continue
      }

      throw new Error(`gateway start failed with code ${result.code}`)
    }

    throw new Error('gateway start failed after exhausting retries')
  }

  async stopGateway(onLog?: LogFn): Promise<void> {
    const code = await this.removeGatewayContainer(onLog)
    if (code !== 0) {
      throw new Error(`gateway stop failed with code ${code}`)
    }
  }

  async restartGateway(
    input: GatewayContainerSpec,
    onLog?: LogFn,
  ): Promise<number> {
    return this.startGateway(input, onLog)
  }

  async inspectGateway(): Promise<GatewayInspection> {
    const result = await this.capturePodmanCommand([
      'inspect',
      OPENCLAW_GATEWAY_CONTAINER_NAME,
    ])

    if (result.code !== 0) {
      if (
        this.isMissingGatewayContainer(`${result.stdout}\n${result.stderr}`)
      ) {
        return {
          exists: false,
          running: false,
          hostPort: null,
        }
      }

      throw new Error(`gateway inspect failed with code ${result.code}`)
    }

    const container = this.parseGatewayInspection(result.stdout)
    if (!container) {
      throw new Error('gateway inspect returned unexpected output')
    }

    return {
      exists: true,
      running:
        container.State?.Running === true ||
        container.State?.Status?.toLowerCase() === 'running',
      hostPort: this.extractGatewayHostPort(container),
    }
  }

  async getGatewayLogs(tail = 50): Promise<string[]> {
    const lines: string[] = []
    await this.runPodmanCommand(
      ['logs', '--tail', String(tail), OPENCLAW_GATEWAY_CONTAINER_NAME],
      (line) => lines.push(line),
    )
    return lines
  }

  async isHealthy(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`)
      return res.ok
    } catch {
      return false
    }
  }

  async isReady(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/readyz`)
      return res.ok
    } catch {
      return false
    }
  }

  async waitForReady(port: number, timeoutMs = 30_000): Promise<boolean> {
    logger.info('Waiting for OpenClaw gateway readiness', { port, timeoutMs })
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.isReady(port)) {
        logger.info('OpenClaw gateway became ready', {
          port,
          waitMs: Date.now() - start,
        })
        return true
      }
      await Bun.sleep(1000)
    }
    logger.error('Timed out waiting for OpenClaw gateway readiness', {
      port,
      timeoutMs,
    })
    return false
  }

  /**
   * Stops the Podman machine only if no non-BrowserOS containers are running.
   * Prevents killing the user's own Podman workloads.
   */
  async stopMachineIfSafe(): Promise<void> {
    const status = await this.podman.getMachineStatus()
    if (!status.running) return

    try {
      const containers = await this.podman.listRunningContainers()
      const allOurs = containers.every(
        (name) => name === OPENCLAW_GATEWAY_CONTAINER_NAME,
      )

      if (containers.length === 0 || allOurs) {
        await this.podman.stopMachine()
      }
    } catch {
      // Best effort — don't stop machine if we can't check
    }
  }

  async execInContainer(command: string[], onLog?: LogFn): Promise<number> {
    return this.podman.runCommand(
      ['exec', OPENCLAW_GATEWAY_CONTAINER_NAME, ...command],
      {
        onOutput: onLog,
      },
    )
  }

  async runGatewaySetupCommand(
    command: string[],
    spec: GatewayContainerSpec,
    onLog?: LogFn,
  ): Promise<number> {
    const setupContainerName = `${OPENCLAW_GATEWAY_CONTAINER_NAME}-setup`
    await this.runPodmanCommand(
      ['rm', '-f', '--ignore', setupContainerName],
      onLog,
    )
    const setupArgs = command[0] === 'node' ? command.slice(1) : command
    return this.runPodmanCommand(
      [
        'run',
        '--rm',
        '--name',
        setupContainerName,
        ...this.buildGatewayContainerRuntimeArgs(spec),
        spec.image,
        'node',
        ...setupArgs,
      ],
      onLog,
    )
  }

  tailGatewayLogs(onLine: LogFn): () => void {
    return this.podman.tailContainerLogs(
      OPENCLAW_GATEWAY_CONTAINER_NAME,
      onLine,
    )
  }

  private async runPodmanCommand(
    args: string[],
    onLog?: LogFn,
  ): Promise<number> {
    const result = await this.runPodmanCommandResult(args, onLog)
    this.logPodmanCommandResult(args, result)
    return result.code
  }

  private async runPodmanCommandResult(
    args: string[],
    onLog?: LogFn,
  ): Promise<{ code: number; output: string[] }> {
    const lines: string[] = []
    const command = ['podman', ...args].join(' ')
    logger.info('Running OpenClaw podman command', {
      command,
    })
    const code = await this.podman.runCommand(args, {
      cwd: this.projectDir,
      onOutput: (line) => {
        lines.push(line)
        onLog?.(line)
      },
    })

    return {
      code,
      output: lines,
    }
  }

  private logPodmanCommandResult(
    args: string[],
    result: { code: number; output: string[] },
  ): void {
    const command = ['podman', ...args].join(' ')
    if (result.code !== 0) {
      logger.error('OpenClaw podman command failed', {
        command,
        exitCode: result.code,
        output: result.output,
      })
    } else {
      logger.info('OpenClaw podman command succeeded', {
        command,
      })
    }
  }

  private async ensureGatewayRemoved(onLog?: LogFn): Promise<void> {
    await this.removeGatewayContainer(onLog)
  }

  private async removeGatewayContainer(onLog?: LogFn): Promise<number> {
    return this.runPodmanCommand(
      ['rm', '-f', '--ignore', OPENCLAW_GATEWAY_CONTAINER_NAME],
      onLog,
    )
  }

  private async chooseGatewayHostPort(
    preferredPort: number,
    attemptedPorts = new Set<number>(),
  ): Promise<number> {
    if (
      !attemptedPorts.has(preferredPort) &&
      (await this.isLocalPortAvailable(preferredPort))
    ) {
      return preferredPort
    }

    return this.allocateDistinctEphemeralPort(attemptedPorts)
  }

  private async isLocalPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer()
      server.unref()
      server.once('error', () => resolve(false))
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.close(() => resolve(true))
      })
    })
  }

  private async allocateEphemeralPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.unref()
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close(() =>
            reject(new Error('failed to resolve ephemeral port')),
          )
          return
        }

        const port = address.port
        server.close((closeError) => {
          if (closeError) {
            reject(closeError)
            return
          }
          resolve(port)
        })
      })
    })
  }

  private async allocateDistinctEphemeralPort(
    attemptedPorts: Set<number>,
  ): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = await this.allocateEphemeralPort()
      if (!attemptedPorts.has(port)) {
        return port
      }
    }

    throw new Error('failed to allocate a distinct gateway host port')
  }

  private isMissingGatewayContainer(output: string): boolean {
    const text = output.toLowerCase()
    return (
      text.includes('no such object') ||
      text.includes('no container') ||
      text.includes('cannot inspect') ||
      text.includes('not found')
    )
  }

  private parseGatewayInspection(
    output: string,
  ): PodmanInspectContainer | null {
    const raw = output.trim()
    if (!raw) return null

    const parsed = JSON.parse(raw) as
      | PodmanInspectContainer
      | PodmanInspectContainer[]
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
  }

  private isGatewayBindConflict(output: string[]): boolean {
    const text = output.join('\n').toLowerCase()
    return (
      text.includes('address already in use') ||
      text.includes('eaddrinuse') ||
      text.includes('port is already allocated') ||
      text.includes('port already allocated') ||
      text.includes('bind: address already in use')
    )
  }

  private extractGatewayHostPort(
    container: PodmanInspectContainer,
  ): number | null {
    const bindings =
      container.NetworkSettings?.Ports?.[`${GATEWAY_CONTAINER_PORT}/tcp`] ??
      container.HostConfig?.PortBindings?.[`${GATEWAY_CONTAINER_PORT}/tcp`]

    const hostPort = bindings?.find((binding) => binding?.HostPort)?.HostPort
    if (!hostPort) return null

    const parsed = Number.parseInt(hostPort, 10)
    return Number.isInteger(parsed) ? parsed : null
  }

  private buildGatewayStartArgs(
    input: GatewayContainerSpec,
    hostPort: number,
  ): string[] {
    return [
      'run',
      '-d',
      '--name',
      OPENCLAW_GATEWAY_CONTAINER_NAME,
      '--restart',
      'unless-stopped',
      '-p',
      `127.0.0.1:${hostPort}:${GATEWAY_CONTAINER_PORT}`,
      ...this.buildGatewayContainerRuntimeArgs(input),
      '--health-cmd',
      `curl -sf http://127.0.0.1:${GATEWAY_CONTAINER_PORT}/healthz`,
      '--health-interval',
      '30s',
      '--health-timeout',
      '10s',
      '--health-retries',
      '3',
      input.image,
      'node',
      'dist/index.js',
      'gateway',
      '--bind',
      'lan',
      '--port',
      String(GATEWAY_CONTAINER_PORT),
      '--allow-unconfigured',
    ]
  }

  private async defaultCapturePodmanCommand(
    args: string[],
    options?: {
      cwd?: string
    },
  ): Promise<PodmanCommandCaptureResult> {
    const command = [this.podman.getPodmanPath(), ...args]
    logger.info('Running OpenClaw podman command', {
      command: command.join(' '),
    })

    const proc = Bun.spawn(command, {
      cwd: options?.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [stdout, stderr, code] = await Promise.all([
      this.readStreamText(proc.stdout),
      this.readStreamText(proc.stderr),
      proc.exited,
    ])

    return { code, stdout, stderr }
  }

  private async readStreamText(
    stream: ReadableStream<Uint8Array> | null,
  ): Promise<string> {
    if (!stream) return ''
    return new Response(stream).text()
  }

  private buildGatewayContainerRuntimeArgs(
    input: GatewayContainerSpec,
  ): string[] {
    return [
      '--env-file',
      input.envFilePath,
      '-e',
      `HOME=${GATEWAY_CONTAINER_HOME}`,
      '-e',
      `OPENCLAW_HOME=${GATEWAY_CONTAINER_HOME}`,
      '-e',
      `OPENCLAW_STATE_DIR=${GATEWAY_STATE_DIR}`,
      '-e',
      'OPENCLAW_NO_RESPAWN=1',
      '-e',
      'NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache',
      '-e',
      'NODE_ENV=production',
      '-e',
      `TZ=${input.timezone}`,
      '-v',
      `${input.hostHome}:${GATEWAY_CONTAINER_HOME}`,
      '--add-host',
      'host.containers.internal:host-gateway',
      ...(input.gatewayToken
        ? ['-e', `OPENCLAW_GATEWAY_TOKEN=${input.gatewayToken}`]
        : []),
    ]
  }
}
