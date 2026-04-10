/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure functions for building OpenClaw configuration files.
 * No side effects — callers handle file I/O.
 */

import { DEFAULT_PORTS } from '@browseros/shared/constants/ports'

const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest'
const OPENCLAW_GATEWAY_PORT = 18789
const CONTAINER_HOME = '/home/node/.openclaw'

export const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}

export interface AgentEntry {
  id: string
  name: string
  workspace: string
  providerType?: string
  modelId?: string
}

export interface OpenClawConfigInput {
  gatewayPort: number
  browserosServerPort?: number
  agents: AgentEntry[]
  providerType?: string
  modelId?: string
}

export interface EnvFileInput {
  image?: string
  port?: number
  token: string
  configDir: string
  timezone?: string
  providerKeys?: Record<string, string>
}

export function buildOpenClawConfig(
  input: OpenClawConfigInput,
): Record<string, unknown> {
  const serverPort = input.browserosServerPort ?? DEFAULT_PORTS.server

  const config: Record<string, unknown> = {
    gateway: {
      mode: 'local',
      port: input.gatewayPort,
      bind: 'lan',
      auth: { mode: 'token' },
      reload: { mode: 'restart' },
      controlUi: {
        allowInsecureAuth: true,
        allowedOrigins: [
          `http://127.0.0.1:${input.gatewayPort}`,
          `http://localhost:${input.gatewayPort}`,
        ],
      },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
        },
      },
    },
    agents: {
      defaults: {
        workspace: `${CONTAINER_HOME}/workspace`,
        timeoutSeconds: 4200,
        thinkingDefault: 'adaptive',
      },
      list: input.agents.map((agent) => {
        const entry: Record<string, unknown> = {
          id: agent.id,
          name: agent.name,
          workspace: agent.workspace,
          tools: { exec: { security: 'full' } },
        }
        if (agent.providerType && agent.modelId) {
          entry.model = {
            primary: `${agent.providerType}/${agent.modelId}`,
          }
        }
        return entry
      }),
    },
    tools: {
      profile: 'full',
      web: {
        search: { provider: 'duckduckgo', enabled: true },
      },
      exec: {
        host: 'gateway',
        security: 'full',
        ask: 'off',
      },
    },
    cron: { enabled: true },
    hooks: {
      internal: {
        enabled: true,
        entries: {
          'boot-md': { enabled: true },
          'bootstrap-extra-files': { enabled: true },
          'session-memory': { enabled: true },
        },
      },
    },
    mcp: {
      servers: {
        browseros: {
          url: `http://host.containers.internal:${serverPort}/mcp`,
          transport: 'streamable-http',
        },
      },
    },
    approvals: {
      exec: { enabled: false },
    },
    skills: {
      install: { nodeManager: 'bun' },
    },
  }

  if (input.providerType && input.modelId) {
    const agentsConfig = config.agents as Record<string, unknown>
    const defaults = agentsConfig.defaults as Record<string, unknown>
    defaults.model = { primary: `${input.providerType}/${input.modelId}` }
  }

  return config
}

export function buildEnvFile(input: EnvFileInput): string {
  const lines: string[] = [
    `OPENCLAW_IMAGE=${input.image ?? OPENCLAW_IMAGE}`,
    `OPENCLAW_GATEWAY_PORT=${input.port ?? OPENCLAW_GATEWAY_PORT}`,
    `OPENCLAW_GATEWAY_TOKEN=${input.token}`,
    `OPENCLAW_CONFIG_DIR=${input.configDir}`,
    `TZ=${input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`,
  ]

  if (input.providerKeys) {
    for (const [key, value] of Object.entries(input.providerKeys)) {
      lines.push(`${key}=${value}`)
    }
  }

  return `${lines.join('\n')}\n`
}

export function makeAgentEntry(
  name: string,
  provider?: { providerType?: string; modelId?: string },
): AgentEntry {
  return {
    id: name,
    name,
    workspace:
      name === 'main'
        ? `${CONTAINER_HOME}/workspace`
        : `${CONTAINER_HOME}/workspace-${name}`,
    providerType: provider?.providerType,
    modelId: provider?.modelId,
  }
}

export function resolveProviderKeys(
  providerType?: string,
  apiKey?: string,
): Record<string, string> {
  const keys: Record<string, string> = {}
  if (!providerType || !apiKey) return keys

  const envVar = PROVIDER_ENV_MAP[providerType]
  if (envVar) {
    keys[envVar] = apiKey
  }
  return keys
}
