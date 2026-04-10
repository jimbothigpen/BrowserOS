/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Main orchestrator for OpenClaw integration.
 * Manages the single OpenClaw container lifecycle, agent CRUD,
 * configuration, and chat proxy.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { getOpenClawDir } from '../../lib/browseros-dir'
import { logger } from '../../lib/logger'
import { ContainerRuntime } from './container-runtime'
import {
  type AgentEntry,
  buildEnvFile,
  buildOpenClawConfig,
  makeAgentEntry,
  resolveProviderKeys,
} from './openclaw-config'
import { getPodmanRuntime } from './podman-runtime'

const COMPOSE_RESOURCE = resolve(
  import.meta.dir,
  '../../../resources/openclaw-compose.yml',
)
const OPENCLAW_CONFIG_FILE = 'openclaw.json'
const GATEWAY_PORT = 18789
const HEALTH_TIMEOUT_MS = 30_000
const CHAT_TIMEOUT_MS = TIMEOUTS.TOOL_CALL
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export type OpenClawStatus =
  | 'uninitialized'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'

export interface OpenClawStatusResponse {
  status: OpenClawStatus
  podmanAvailable: boolean
  machineReady: boolean
  port: number | null
  agentCount: number
  error: string | null
}

export interface SetupInput {
  providerType?: string
  apiKey?: string
  modelId?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export class OpenClawService {
  private runtime: ContainerRuntime
  private openclawDir: string
  private port = GATEWAY_PORT
  private token: string
  private lastError: string | null = null

  constructor() {
    this.openclawDir = getOpenClawDir()
    this.runtime = new ContainerRuntime(getPodmanRuntime(), this.openclawDir)
    this.token = crypto.randomUUID()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async setup(input: SetupInput, onLog?: (msg: string) => void): Promise<void> {
    onLog?.('Checking container runtime...')
    const available = await this.runtime.isPodmanAvailable()
    if (!available) {
      throw new Error(
        'Podman is not available. Install Podman to use OpenClaw agents.',
      )
    }

    await this.runtime.ensureReady(onLog)
    onLog?.('Container runtime ready')

    await mkdir(this.openclawDir, { recursive: true })
    await mkdir(join(this.openclawDir, 'workspace'), { recursive: true })

    onLog?.('Copying compose file...')
    await this.runtime.copyComposeFile(COMPOSE_RESOURCE)

    this.token = crypto.randomUUID()
    const providerKeys = resolveProviderKeys(input.providerType, input.apiKey)
    const envContent = buildEnvFile({
      token: this.token,
      configDir: this.openclawDir,
      providerKeys,
    })
    await this.runtime.writeEnvFile(envContent)
    onLog?.('Generated .env file')

    const mainAgent = makeAgentEntry('main')
    const config = buildOpenClawConfig({
      gatewayPort: this.port,
      agents: [mainAgent],
      providerType: input.providerType,
      modelId: input.modelId,
    })
    await this.writeConfig(config)
    onLog?.('Generated openclaw.json')

    onLog?.('Pulling OpenClaw image...')
    await this.runtime.composePull(onLog)
    onLog?.('Image ready')

    onLog?.('Starting OpenClaw gateway...')
    await this.runtime.composeUp(onLog)

    onLog?.('Waiting for gateway health...')
    const healthy = await this.runtime.waitForHealthy(
      this.port,
      HEALTH_TIMEOUT_MS,
    )
    if (!healthy) {
      this.lastError = 'Gateway did not become healthy within 30 seconds'
      const logs = await this.runtime.composeLogs()
      logger.error('Gateway health check failed', { logs })
      throw new Error(this.lastError)
    }

    this.lastError = null
    onLog?.(`OpenClaw gateway running at http://127.0.0.1:${this.port}`)
    logger.info('OpenClaw setup complete', { port: this.port })
  }

  async start(onLog?: (msg: string) => void): Promise<void> {
    await this.loadTokenFromEnv()
    await this.runtime.ensureReady(onLog)
    await this.runtime.composeUp(onLog)

    const healthy = await this.runtime.waitForHealthy(
      this.port,
      HEALTH_TIMEOUT_MS,
    )
    if (!healthy) {
      this.lastError = 'Gateway did not become healthy after start'
      throw new Error(this.lastError)
    }
    this.lastError = null
  }

  async stop(): Promise<void> {
    await this.runtime.composeStop()
    logger.info('OpenClaw container stopped')
  }

  async restart(onLog?: (msg: string) => void): Promise<void> {
    await this.loadTokenFromEnv()
    onLog?.('Restarting OpenClaw gateway...')
    await this.runtime.composeRestart(onLog)

    const healthy = await this.runtime.waitForHealthy(
      this.port,
      HEALTH_TIMEOUT_MS,
    )
    if (!healthy) {
      this.lastError = 'Gateway did not become healthy after restart'
      throw new Error(this.lastError)
    }
    this.lastError = null
    onLog?.('Gateway restarted successfully')
  }

  async shutdown(): Promise<void> {
    try {
      await this.runtime.composeStop()
    } catch {
      // Best effort during shutdown
    }
    await this.runtime.stopMachineIfSafe()
    logger.info('OpenClaw shutdown complete')
  }

  // ── Status ───────────────────────────────────────────────────────────

  async getStatus(): Promise<OpenClawStatusResponse> {
    const podmanAvailable = await this.runtime.isPodmanAvailable()
    if (!podmanAvailable) {
      return {
        status: 'uninitialized',
        podmanAvailable: false,
        machineReady: false,
        port: null,
        agentCount: 0,
        error: null,
      }
    }

    const isSetUp = existsSync(join(this.openclawDir, OPENCLAW_CONFIG_FILE))
    if (!isSetUp) {
      const machineStatus = await this.runtime.getMachineStatus()
      return {
        status: 'uninitialized',
        podmanAvailable: true,
        machineReady: machineStatus.running,
        port: null,
        agentCount: 0,
        error: null,
      }
    }

    const machineStatus = await this.runtime.getMachineStatus()
    const healthy = machineStatus.running
      ? await this.runtime.isHealthy(this.port)
      : false

    let agentCount = 0
    try {
      const agents = await this.listAgents()
      agentCount = agents.length
    } catch {
      // Config may be unreadable
    }

    return {
      status: healthy ? 'running' : this.lastError ? 'error' : 'stopped',
      podmanAvailable: true,
      machineReady: machineStatus.running,
      port: this.port,
      agentCount,
      error: this.lastError,
    }
  }

  // ── Agent Management ─────────────────────────────────────────────────

  async createAgent(input: {
    name: string
    providerType?: string
    apiKey?: string
    modelId?: string
  }): Promise<AgentEntry> {
    const { name } = input
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new Error(
        'Agent name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
      )
    }

    const config = await this.readConfig()
    const agents = this.getAgentsList(config)

    if (agents.some((a) => a.id === name)) {
      throw new Error(`Agent "${name}" already exists`)
    }

    const entry = makeAgentEntry(name, {
      providerType: input.providerType,
      modelId: input.modelId,
    })

    // Create workspace on host (visible inside container via volume mount)
    const hostWorkspaceDir = join(this.openclawDir, `workspace-${name}`)
    await mkdir(hostWorkspaceDir, { recursive: true })

    agents.push(entry)
    this.setAgentsList(config, agents)
    await this.writeConfig(config)

    // Merge new provider API key into .env so the container has access
    if (input.providerType && input.apiKey) {
      await this.mergeProviderKey(input.providerType, input.apiKey)
    }

    await this.restart()
    logger.info('Agent created', {
      agentId: name,
      providerType: input.providerType,
    })
    return entry
  }

  async removeAgent(agentId: string): Promise<void> {
    if (agentId === 'main') {
      throw new Error('Cannot delete the main agent')
    }

    const config = await this.readConfig()
    const agents = this.getAgentsList(config)
    const index = agents.findIndex((a) => a.id === agentId)

    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`)
    }

    agents.splice(index, 1)
    this.setAgentsList(config, agents)
    await this.writeConfig(config)

    // Remove workspace
    const hostWorkspaceDir = join(this.openclawDir, `workspace-${agentId}`)
    await rm(hostWorkspaceDir, { recursive: true, force: true })

    await this.restart()
    logger.info('Agent removed', { agentId })
  }

  async listAgents(): Promise<AgentEntry[]> {
    const config = await this.readConfig()
    return this.getAgentsList(config)
  }

  // ── Chat Proxy ───────────────────────────────────────────────────────

  async chat(_agentId: string, messages: ChatMessage[]): Promise<Response> {
    await this.loadTokenFromEnv()
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        model: 'default',
        stream: true,
        messages,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenClaw error (${response.status}): ${errText}`)
    }

    return response
  }

  // ── Provider Keys ────────────────────────────────────────────────────

  async updateProviderKeys(
    providerType: string,
    apiKey: string,
    modelId?: string,
  ): Promise<void> {
    const providerKeys = resolveProviderKeys(providerType, apiKey)
    await this.loadTokenFromEnv()

    const envContent = buildEnvFile({
      token: this.token,
      configDir: this.openclawDir,
      providerKeys,
    })
    await this.runtime.writeEnvFile(envContent)

    if (modelId) {
      const config = await this.readConfig()
      const agents = config.agents as Record<string, unknown> | undefined
      if (agents) {
        const defaults = (agents.defaults ?? {}) as Record<string, unknown>
        defaults.model = { primary: `${providerType}/${modelId}` }
        agents.defaults = defaults
      }
      await this.writeConfig(config)
    }

    await this.restart()
    logger.info('Provider keys updated', { providerType })
  }

  // ── Logs ─────────────────────────────────────────────────────────────

  async getLogs(tail = 100): Promise<string[]> {
    return this.runtime.composeLogs(tail)
  }

  // ── Auto-start on BrowserOS boot ────────────────────────────────────

  async tryAutoStart(): Promise<void> {
    const isSetUp = existsSync(join(this.openclawDir, OPENCLAW_CONFIG_FILE))
    if (!isSetUp) return

    const available = await this.runtime.isPodmanAvailable()
    if (!available) return

    try {
      await this.loadTokenFromEnv()
      await this.runtime.ensureReady()

      if (await this.runtime.isHealthy(this.port)) {
        logger.info('OpenClaw gateway already running')
        return
      }

      await this.runtime.composeUp()
      const healthy = await this.runtime.waitForHealthy(
        this.port,
        HEALTH_TIMEOUT_MS,
      )
      if (healthy) {
        logger.info('OpenClaw gateway auto-started')
      } else {
        logger.warn('OpenClaw gateway failed to become healthy on auto-start')
      }
    } catch (err) {
      logger.warn('OpenClaw auto-start failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async readConfig(): Promise<Record<string, unknown>> {
    const configPath = join(this.openclawDir, OPENCLAW_CONFIG_FILE)
    const content = await readFile(configPath, 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  }

  private async writeConfig(config: Record<string, unknown>): Promise<void> {
    const configPath = join(this.openclawDir, OPENCLAW_CONFIG_FILE)
    await writeFile(configPath, JSON.stringify(config, null, 2))
  }

  private getAgentsList(config: Record<string, unknown>): AgentEntry[] {
    const agents = config.agents as Record<string, unknown> | undefined
    if (!agents) return []
    const list = agents.list as AgentEntry[] | undefined
    return list ? [...list] : []
  }

  private setAgentsList(
    config: Record<string, unknown>,
    agents: AgentEntry[],
  ): void {
    const agentsConfig = (config.agents ?? {}) as Record<string, unknown>
    agentsConfig.list = agents
    config.agents = agentsConfig
  }

  /**
   * Reads the current .env, adds/updates the provider's API key, writes it back.
   * Multiple providers can coexist (e.g. ANTHROPIC_API_KEY + OPENAI_API_KEY).
   */
  private async mergeProviderKey(
    providerType: string,
    apiKey: string,
  ): Promise<void> {
    const newKeys = resolveProviderKeys(providerType, apiKey)
    if (Object.keys(newKeys).length === 0) return

    const envPath = join(this.openclawDir, '.env')
    let content = ''
    try {
      content = await readFile(envPath, 'utf-8')
    } catch {
      // .env may not exist yet
    }

    for (const [key, value] of Object.entries(newKeys)) {
      const pattern = new RegExp(`^${key}=.*$`, 'm')
      if (pattern.test(content)) {
        content = content.replace(pattern, `${key}=${value}`)
      } else {
        content = `${content.trimEnd()}\n${key}=${value}\n`
      }
    }

    await writeFile(envPath, content, { mode: 0o600 })
  }

  private async loadTokenFromEnv(): Promise<void> {
    const envPath = join(this.openclawDir, '.env')
    try {
      const content = await readFile(envPath, 'utf-8')
      const match = content.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m)
      if (match) {
        this.token = match[1]
      }
    } catch {
      // .env may not exist yet
    }
  }
}

let service: OpenClawService | null = null

export function getOpenClawService(): OpenClawService {
  if (!service) service = new OpenClawService()
  return service
}
