/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OpenClaw container lifecycle abstraction over PodmanRuntime.
 */

import { OPENCLAW_GATEWAY_CONTAINER_NAME } from '@browseros/shared/constants/openclaw'
import { logger } from '../../../lib/logger'
import type { LogFn, PodmanRuntime } from './podman-runtime'

const GATEWAY_CONTAINER_HOME = '/home/node'
const GATEWAY_STATE_DIR = `${GATEWAY_CONTAINER_HOME}/.openclaw`

export type GatewayContainerSpec = {
  image: string
  port: number
  hostHome: string
  envFilePath: string
  gatewayToken?: string
  timezone: string
}

export class ContainerRuntime {
  constructor(
    private podman: PodmanRuntime,
    private projectDir: string,
  ) {}

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
  ): Promise<void> {
    await this.ensureGatewayRemoved(onLog)
    const code = await this.runPodmanCommand(
      [
        'run',
        '-d',
        '--name',
        OPENCLAW_GATEWAY_CONTAINER_NAME,
        '--restart',
        'unless-stopped',
        '-p',
        `127.0.0.1:${input.port}:18789`,
        ...this.buildGatewayContainerRuntimeArgs(input),
        '--health-cmd',
        'curl -sf http://127.0.0.1:18789/healthz',
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
        '18789',
        '--allow-unconfigured',
      ],
      onLog,
    )
    if (code !== 0) throw new Error(`gateway start failed with code ${code}`)
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
  ): Promise<void> {
    await this.startGateway(input, onLog)
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

    if (code !== 0) {
      logger.error('OpenClaw podman command failed', {
        command,
        exitCode: code,
        output: lines,
      })
    } else {
      logger.info('OpenClaw podman command succeeded', {
        command,
      })
    }

    return code
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
