/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'

type LogFn = (line: string) => void

interface ContainerExecutor {
  execInContainer(command: string[], onLog?: LogFn): Promise<number>
}

export interface OpenClawConfigBatchEntry {
  path: string
  value: unknown
}

interface RawAgentRecord {
  id: string
  name?: string
  workspace: string
  model?: string
}

export interface OpenClawAgentRecord {
  agentId: string
  name: string
  workspace: string
  model?: string
}

export class OpenClawCliClient {
  constructor(private readonly executor: ContainerExecutor) {}

  async runOnboard(
    input: {
      acceptRisk?: boolean
      authChoice?: string
      customBaseUrl?: string
      customCompatibility?: 'anthropic' | 'openai-completions'
      customModelId?: string
      customProviderId?: string
      gatewayAuth?: 'none' | 'password' | 'token'
      gatewayBind?: 'auto' | 'custom' | 'lan' | 'loopback' | 'tailnet'
      gatewayPort?: number
      gatewayToken?: string
      gatewayTokenRefEnv?: string
      installDaemon?: boolean
      mode?: 'local' | 'remote'
      nonInteractive?: boolean
      reset?: boolean
      resetScope?: 'config' | 'config+creds+sessions' | 'full'
      secretInputMode?: 'plain' | 'ref'
      skipHealth?: boolean
      workspace?: string
    } = {},
  ): Promise<void> {
    const args = ['onboard']

    if (input.nonInteractive) {
      args.push('--non-interactive')
    }
    if (input.mode) {
      args.push('--mode', input.mode)
    }
    if (input.workspace) {
      args.push('--workspace', input.workspace)
    }
    if (input.reset) {
      args.push('--reset')
    }
    if (input.resetScope) {
      args.push('--reset-scope', input.resetScope)
    }
    if (input.authChoice) {
      args.push('--auth-choice', input.authChoice)
    }
    if (input.secretInputMode) {
      args.push('--secret-input-mode', input.secretInputMode)
    }
    if (input.customBaseUrl) {
      args.push('--custom-base-url', input.customBaseUrl)
    }
    if (input.customModelId) {
      args.push('--custom-model-id', input.customModelId)
    }
    if (input.customProviderId) {
      args.push('--custom-provider-id', input.customProviderId)
    }
    if (input.customCompatibility) {
      args.push('--custom-compatibility', input.customCompatibility)
    }
    if (input.gatewayAuth) {
      args.push('--gateway-auth', input.gatewayAuth)
    }
    if (input.gatewayToken) {
      args.push('--gateway-token', input.gatewayToken)
    }
    if (input.gatewayTokenRefEnv) {
      args.push('--gateway-token-ref-env', input.gatewayTokenRefEnv)
    }
    if (input.gatewayPort) {
      args.push('--gateway-port', String(input.gatewayPort))
    }
    if (input.gatewayBind) {
      args.push('--gateway-bind', input.gatewayBind)
    }
    if (input.installDaemon === true) {
      args.push('--install-daemon')
    } else if (input.installDaemon === false) {
      args.push('--no-install-daemon')
    }
    if (input.skipHealth) {
      args.push('--skip-health')
    }
    if (input.acceptRisk) {
      args.push('--accept-risk')
    }

    await this.runCommand(args)
  }

  async setConfig(path: string, value: unknown): Promise<void> {
    await this.runCommand(['config', 'set', path, formatConfigValue(value)])
  }

  async setConfigBatch(entries: OpenClawConfigBatchEntry[]): Promise<void> {
    await this.runCommand([
      'config',
      'set',
      '--batch-json',
      JSON.stringify(entries),
    ])
  }

  async getConfig(path: string): Promise<unknown> {
    const output = await this.runCommand(['config', 'get', path])
    return parseConfigValue(output)
  }

  async validateConfig(): Promise<unknown> {
    const output = await this.runCommand(['config', 'validate', '--json'])
    return parseConfigValue(output)
  }

  async setDefaultModel(model: string): Promise<void> {
    await this.runCommand(['models', 'set', model])
  }

  async listAgents(): Promise<OpenClawAgentRecord[]> {
    const records = await this.runAgentListCommand()
    const agents = Array.isArray(records) ? records : (records.agents ?? [])
    return agents.map((record) => ({
      agentId: record.id,
      name: record.name ?? record.id,
      workspace: record.workspace,
      model: record.model,
    }))
  }

  async createAgent(input: {
    name: string
    model?: string
  }): Promise<OpenClawAgentRecord> {
    const workspace = this.agentWorkspace(input.name)
    const args = ['agents', 'add', input.name, '--workspace', workspace]

    if (input.model) {
      args.push('--model', input.model)
    }

    args.push('--non-interactive', '--json')
    await this.runCommand(args)

    const agents = await this.listAgents()
    const agent = agents.find((entry) => entry.agentId === input.name)
    if (!agent) {
      throw new Error(`Created agent ${input.name} was not found in agent list`)
    }

    return agent
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.runCommand(['agents', 'delete', agentId, '--force', '--json'])
  }

  async probe(): Promise<void> {
    await this.listAgents()
  }

  private agentWorkspace(name: string): string {
    return name === 'main'
      ? `${OPENCLAW_CONTAINER_HOME}/workspace`
      : `${OPENCLAW_CONTAINER_HOME}/workspace-${name}`
  }

  private async runCommand(args: string[]): Promise<string> {
    const output: string[] = []
    const command = ['node', 'dist/index.js', ...args]
    const exitCode = await this.executor.execInContainer(command, (line) => {
      output.push(line)
    })

    if (exitCode !== 0) {
      const detail = output.join('\n').trim()
      throw new Error(
        detail || `OpenClaw command failed (${args.slice(0, 2).join(' ')})`,
      )
    }

    return output.join('\n').trim()
  }

  private async runAgentListCommand(): Promise<
    RawAgentRecord[] | { agents?: RawAgentRecord[] }
  > {
    const output = await this.runCommand(['agents', 'list', '--json'])
    return parseAgentListOutput(output)
  }
}

function formatConfigValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function parseConfigValue(output: string): unknown {
  const parsed = selectConfigJson<unknown>(output)
  return parsed ?? output
}

function parseAgentListOutput(
  output: string,
): RawAgentRecord[] | { agents?: RawAgentRecord[] } {
  const parsed = parseFirstMatchingJson<
    RawAgentRecord[] | { agents?: RawAgentRecord[] }
  >(output, isAgentListPayload)
  if (parsed !== null) return parsed

  throw new Error(
    `Failed to parse OpenClaw JSON output: ${output.slice(0, 200)}`,
  )
}

function parseFirstMatchingJson<T>(
  output: string,
  predicate?: (value: unknown) => boolean,
): T | null {
  const candidates = collectJsonCandidates(output)

  for (const candidate of candidates) {
    const parsed = tryParseJson<T>(candidate)
    if (parsed === null) continue
    if (predicate && !predicate(parsed)) continue
    return parsed
  }

  return null
}

function selectConfigJson<T>(output: string): T | null {
  const candidates = collectJsonCandidates(output)
  const parsedCandidates: Array<{ text: string; value: T }> = []

  for (const candidate of candidates) {
    const parsed = tryParseJson<T>(candidate)
    if (parsed === null) continue
    if (isStructuredLogPayload(parsed)) continue
    parsedCandidates.push({ text: candidate, value: parsed })
  }

  if (parsedCandidates.length === 0) return null

  return parsedCandidates.reduce((best, candidate) =>
    candidate.text.length > best.text.length ? candidate : best,
  ).value
}

function collectJsonCandidates(output: string): string[] {
  const candidates = [output.trim()]

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) candidates.push(trimmed)
  }

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index]
    if (char !== '[' && char !== '{') continue
    const extracted = extractJsonSubstring(output, index)
    if (extracted) {
      candidates.push(extracted)
    }
  }

  return candidates
}

function extractJsonSubstring(
  output: string,
  startIndex: number,
): string | null {
  const opening = output[startIndex]
  const closing = opening === '{' ? '}' : ']'
  const stack: string[] = [closing]
  let inString = false
  let escaped = false

  for (let index = startIndex + 1; index < output.length; index += 1) {
    const char = output[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      stack.push('}')
      continue
    }

    if (char === '[') {
      stack.push(']')
      continue
    }

    const expectedClosing = stack[stack.length - 1]
    if (char === expectedClosing) {
      stack.pop()
      if (stack.length === 0) {
        return output.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function tryParseJson<T>(value: string): T | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

function isAgentListPayload(
  value: unknown,
): value is RawAgentRecord[] | { agents?: RawAgentRecord[] } {
  if (Array.isArray(value)) {
    return value.every(isRawAgentRecord)
  }

  if (!isPlainObject(value)) return false

  if (!('agents' in value)) return false

  const agents = (value as { agents?: unknown }).agents
  return (
    agents === undefined ||
    (Array.isArray(agents) && agents.every(isRawAgentRecord))
  )
}

function isRawAgentRecord(value: unknown): value is RawAgentRecord {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.workspace === 'string' &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.model === undefined || typeof value.model === 'string')
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStructuredLogPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false

  return (
    typeof value.level === 'string' &&
    (typeof value.message === 'string' || typeof value.msg === 'string')
  )
}
