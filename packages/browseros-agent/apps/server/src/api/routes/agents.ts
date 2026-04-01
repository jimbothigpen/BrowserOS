/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent management routes for OpenClaw container instances.
 * Generates docker-compose.yml and uses Podman compose for lifecycle.
 * Manages Podman machine (Linux VM) automatically on macOS/Windows.
 * Persists agent metadata to ~/.browseros/agents.json.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { getBrowserosDir } from '../../lib/browseros-dir'
import { logger } from '../../lib/logger'
import { getPodmanRuntime } from '../services/podman-runtime'

const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest'
const MAX_LOG_LINES = 1000

// Maps BrowserOS provider types to OpenClaw environment variable names
const OPENCLAW_PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}

// Persisted to agents.json
interface AgentRecord {
  id: string
  name: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  port: number
  dir: string
  token: string
  createdAt: string
  error?: string
  providerType?: string
}

// Runtime-only (not persisted)
interface AgentRuntime {
  logs: string[]
  logListeners: Set<(line: string) => void>
}

type AgentInstance = AgentRecord & AgentRuntime

// ─── Persistence ────────────────────────────────────────────────────────────

function getAgentsJsonPath(): string {
  return path.join(getBrowserosDir(), 'agents.json')
}

function getAgentsBaseDir(): string {
  return path.join(getBrowserosDir(), 'agents')
}

const instances = new Map<string, AgentInstance>()

function saveAgents(): void {
  const records: AgentRecord[] = Array.from(instances.values()).map(
    ({ logs: _, logListeners: __, ...record }) => record,
  )
  try {
    const filePath = getAgentsJsonPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2))
  } catch (err) {
    logger.warn('Failed to save agents.json', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function loadAgents(): void {
  try {
    const filePath = getAgentsJsonPath()
    if (!fs.existsSync(filePath)) return

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentRecord[]
    for (const record of data) {
      instances.set(record.id, {
        ...record,
        logs: [],
        logListeners: new Set(),
      })
    }
    logger.info(`Loaded ${data.length} agent(s) from agents.json`)
  } catch (err) {
    logger.warn('Failed to load agents.json', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Load persisted agents on module init
loadAgents()

// ─── Helpers ────────────────────────────────────────────────────────────────

function pushLog(instance: AgentInstance, line: string) {
  const timestamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`
  instance.logs.push(timestamped)
  if (instance.logs.length > MAX_LOG_LINES) {
    instance.logs.splice(0, instance.logs.length - MAX_LOG_LINES)
  }
  for (const listener of instance.logListeners) {
    listener(timestamped)
  }
}

function updateStatus(
  instance: AgentInstance,
  status: AgentRecord['status'],
  error?: string,
): void {
  instance.status = status
  instance.error = error
  saveAgents()
}

async function isRuntimeAvailable(): Promise<boolean> {
  return getPodmanRuntime().isPodmanAvailable()
}

async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort))
    })
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1))
    })
  })
}

async function runCommandWithLogs(
  instance: AgentInstance,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<number> {
  const seen = new Set<string>()
  return getPodmanRuntime().runCommand(args, {
    cwd: options?.cwd,
    env: options?.env,
    onOutput: (line) => {
      if (!seen.has(line)) {
        seen.add(line)
        pushLog(instance, line)
      }
    },
  })
}

function composeEnv(name: string): Record<string, string> {
  return { COMPOSE_PROJECT_NAME: `browseros-claw-${name}` }
}

function generateComposeFile(config: {
  image: string
  gatewayPort: number
  token: string
  configDir: string
  workspaceDir: string
}): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return `services:
  openclaw-gateway:
    image: ${config.image}
    ports:
      - "127.0.0.1:${config.gatewayPort}:18789"
    environment:
      - OPENCLAW_GATEWAY_TOKEN=${config.token}
      - TZ=${tz}
    volumes:
      - ${config.configDir}:/home/node/.openclaw
      - ${config.workspaceDir}:/home/node/.openclaw/workspace
    command: node dist/index.js gateway --bind lan --port 18789
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:18789/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
`
}

function generateOpenClawConfig(config: {
  port: number
  providerType?: string
  apiKey?: string
  baseUrl?: string
  modelId?: string
  providerName?: string
}): Record<string, unknown> {
  const openclawConfig: Record<string, unknown> = {
    gateway: {
      mode: 'local',
      controlUi: {
        allowedOrigins: [
          `http://127.0.0.1:${config.port}`,
          `http://localhost:${config.port}`,
        ],
      },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
        },
      },
    },
  }

  if (!config.apiKey || !config.providerType) {
    return openclawConfig
  }

  const directEnvVar = OPENCLAW_PROVIDER_ENV_MAP[config.providerType]

  if (directEnvVar) {
    // Built-in provider (Anthropic, OpenAI, Google, etc.)
    openclawConfig.env = { [directEnvVar]: config.apiKey }
    if (config.modelId) {
      openclawConfig.agents = {
        defaults: {
          model: { primary: `${config.providerType}/${config.modelId}` },
        },
      }
    }
  } else if (config.baseUrl) {
    // Custom OpenAI-compatible provider
    const providerId = (config.providerName || 'custom-provider')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const envVarName = `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`

    openclawConfig.env = { [envVarName]: config.apiKey }
    openclawConfig.models = {
      mode: 'merge',
      providers: {
        [providerId]: {
          baseUrl: config.baseUrl,
          apiKey: `\${${envVarName}}`,
          api: 'openai-completions',
          ...(config.modelId
            ? { models: [{ id: config.modelId, name: config.modelId }] }
            : {}),
        },
      },
    }
    if (config.modelId) {
      openclawConfig.agents = {
        defaults: {
          model: { primary: `${providerId}/${config.modelId}` },
        },
      }
    }
  }

  return openclawConfig
}

async function dumpContainerLogs(
  instance: AgentInstance,
  agentDir: string,
  name: string,
): Promise<void> {
  try {
    if (fs.existsSync(path.join(agentDir, 'docker-compose.yml'))) {
      pushLog(instance, '--- Container logs ---')
      await runCommandWithLogs(
        instance,
        ['compose', 'logs', '--no-color', '--tail', '50'],
        { cwd: agentDir, env: composeEnv(name) },
      )
      pushLog(instance, '--- End container logs ---')
    }
  } catch {
    // Best effort
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function createAgentsRoutes() {
  return new Hono()
    .get('/', (c) => {
      const agentList = Array.from(instances.values()).map(
        ({ logListeners: _, logs: __, ...rest }) => rest,
      )
      return c.json({ agents: agentList })
    })

    .get('/runtime-status', async (c) => {
      const runtime = getPodmanRuntime()
      const available = await runtime.isPodmanAvailable()
      const machineStatus = available ? await runtime.getMachineStatus() : null
      return c.json({
        available,
        machineInitialized: machineStatus?.initialized ?? false,
        machineRunning: machineStatus?.running ?? false,
        needsSetup: available && !machineStatus?.initialized,
      })
    })

    .get('/:id/logs', (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      c.header('Content-Type', 'text/event-stream')
      c.header('Cache-Control', 'no-cache')
      c.header('Connection', 'keep-alive')

      return stream(c, async (s) => {
        const write = async (line: string) => {
          await s.write(`data: ${JSON.stringify(line)}\n\n`)
        }

        for (const line of instance.logs) {
          await write(line)
        }

        const onLog = (line: string) => {
          write(line).catch(() => {
            instance.logListeners.delete(onLog)
          })
        }
        instance.logListeners.add(onLog)

        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            instance.logListeners.delete(onLog)
            resolve()
          })
        })
      })
    })

    .post('/create', async (c) => {
      const body = await c.req.json<{
        name: string
        providerType?: string
        apiKey?: string
        baseUrl?: string
        modelId?: string
        providerName?: string
      }>()
      const name = body.name?.trim()

      if (!name) {
        return c.json({ error: 'Name is required' }, 400)
      }

      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
        return c.json(
          {
            error:
              'Name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores',
          },
          400,
        )
      }

      const existing = Array.from(instances.values()).find(
        (i) => i.name === name,
      )
      if (existing) {
        return c.json({ error: `Agent "${name}" already exists` }, 409)
      }

      const runtimeAvailable = await isRuntimeAvailable()
      if (!runtimeAvailable) {
        return c.json(
          {
            error:
              'Podman is not available. Install Podman to create local agents.',
          },
          503,
        )
      }

      const id = crypto.randomUUID()
      const port = await findAvailablePort(18789)
      const agentDir = path.join(getAgentsBaseDir(), name)
      const token = crypto.randomUUID()

      const instance: AgentInstance = {
        id,
        name,
        status: 'creating',
        port,
        dir: agentDir,
        token,
        createdAt: new Date().toISOString(),
        providerType: body.providerType,
        logs: [],
        logListeners: new Set(),
      }
      instances.set(id, instance)
      saveAgents()

      logger.info('Creating OpenClaw agent instance', {
        id,
        name,
        port,
        dir: agentDir,
      })

      // Set up and start in the background
      ;(async () => {
        try {
          const configDir = path.join(agentDir, 'config')
          const workspaceDir = path.join(agentDir, 'workspace')
          fs.mkdirSync(configDir, { recursive: true })
          fs.mkdirSync(workspaceDir, { recursive: true })
          pushLog(instance, 'Created agent directories')

          // Generate docker-compose.yml
          const composeContent = generateComposeFile({
            image: OPENCLAW_IMAGE,
            gatewayPort: port,
            token,
            configDir,
            workspaceDir,
          })
          fs.writeFileSync(
            path.join(agentDir, 'docker-compose.yml'),
            composeContent,
          )
          pushLog(instance, 'Generated docker-compose.yml')

          // Write openclaw.json config (gateway mode, allowed origins, LLM provider, model)
          const openclawConfig = generateOpenClawConfig({
            port,
            providerType: body.providerType,
            apiKey: body.apiKey,
            baseUrl: body.baseUrl,
            modelId: body.modelId,
            providerName: body.providerName,
          })
          fs.writeFileSync(
            path.join(configDir, 'openclaw.json'),
            JSON.stringify(openclawConfig, null, 2),
          )
          pushLog(instance, 'Wrote openclaw.json configuration')

          pushLog(instance, 'Checking container runtime...')
          await getPodmanRuntime().ensureReady((msg) => pushLog(instance, msg))
          pushLog(instance, 'Container runtime ready')

          pushLog(instance, `Pulling image ${OPENCLAW_IMAGE}...`)
          const pullExit = await runCommandWithLogs(
            instance,
            ['compose', 'pull', '--quiet'],
            { cwd: agentDir, env: composeEnv(name) },
          )
          if (pullExit !== 0) {
            throw new Error('Failed to pull OpenClaw image')
          }
          pushLog(instance, 'Image pulled successfully')

          pushLog(instance, 'Starting OpenClaw gateway...')
          const upExit = await runCommandWithLogs(
            instance,
            ['compose', 'up', '-d'],
            { cwd: agentDir, env: composeEnv(name) },
          )
          if (upExit !== 0) {
            throw new Error('Failed to start OpenClaw containers')
          }

          pushLog(instance, 'Waiting for gateway to be ready...')
          let healthy = false
          for (let i = 0; i < 30; i++) {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/healthz`)
              if (res.ok) {
                healthy = true
                break
              }
            } catch {
              // Not ready yet
            }
            await Bun.sleep(1000)
          }

          if (!healthy) {
            await dumpContainerLogs(instance, agentDir, name)
            throw new Error('Gateway did not become healthy within 30 seconds')
          }

          pushLog(
            instance,
            `OpenClaw gateway is ready at ws://127.0.0.1:${port}`,
          )
          pushLog(instance, `Control UI available at http://127.0.0.1:${port}`)
          updateStatus(instance, 'running')
          logger.info('OpenClaw agent instance started', { id, name, port })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          pushLog(instance, `ERROR: ${message}`)
          await dumpContainerLogs(instance, agentDir, name)
          updateStatus(instance, 'error', message)
          logger.error('Failed to create OpenClaw agent instance', {
            id,
            error: message,
          })
        }
      })()

      return c.json(
        {
          agent: {
            id,
            name,
            status: 'creating',
            port,
            dir: agentDir,
            token,
            createdAt: instance.createdAt,
          },
        },
        201,
      )
    })

    .post('/:id/stop', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      try {
        await getPodmanRuntime().ensureReady()

        pushLog(instance, 'Stopping agent...')
        await runCommandWithLogs(instance, ['compose', 'stop'], {
          cwd: instance.dir,
          env: composeEnv(instance.name),
        })
        updateStatus(instance, 'stopped')
        pushLog(instance, 'Agent stopped')
        return c.json({
          agent: {
            id,
            name: instance.name,
            status: instance.status,
            port: instance.port,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        pushLog(instance, `ERROR stopping: ${message}`)
        return c.json({ error: `Failed to stop agent: ${message}` }, 500)
      }
    })

    .post('/:id/start', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      try {
        pushLog(instance, 'Ensuring container runtime is ready...')
        await getPodmanRuntime().ensureReady((msg) => pushLog(instance, msg))

        pushLog(instance, 'Starting agent...')
        await runCommandWithLogs(instance, ['compose', 'up', '-d'], {
          cwd: instance.dir,
          env: composeEnv(instance.name),
        })
        updateStatus(instance, 'running')
        pushLog(instance, 'Agent started')
        return c.json({
          agent: {
            id,
            name: instance.name,
            status: instance.status,
            port: instance.port,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        pushLog(instance, `ERROR starting: ${message}`)
        return c.json({ error: `Failed to start agent: ${message}` }, 500)
      }
    })

    .post('/:id/chat', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }
      if (instance.status !== 'running') {
        return c.json({ error: 'Agent is not running' }, 400)
      }

      const body = await c.req.json<{ message: string }>()
      if (!body.message?.trim()) {
        return c.json({ error: 'Message is required' }, 400)
      }

      const openclawUrl = `http://127.0.0.1:${instance.port}/v1/chat/completions`

      try {
        const response = await fetch(openclawUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${instance.token}`,
          },
          body: JSON.stringify({
            model: 'openclaw/default',
            stream: true,
            messages: [{ role: 'user', content: body.message.trim() }],
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          return c.json(
            { error: `OpenClaw error: ${errText}` },
            response.status as 400,
          )
        }

        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')

        return stream(c, async (s) => {
          const reader = (
            response.body as ReadableStream<Uint8Array>
          ).getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            await s.write(value)
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to chat: ${message}` }, 500)
      }
    })

    .delete('/:id', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      try {
        await getPodmanRuntime().ensureReady()

        for (const listener of instance.logListeners) {
          instance.logListeners.delete(listener)
        }

        await runCommandWithLogs(instance, ['compose', 'down', '-v'], {
          cwd: instance.dir,
          env: composeEnv(instance.name),
        })
        fs.rmSync(instance.dir, { recursive: true, force: true })
        instances.delete(id)
        saveAgents()
        return c.json({ success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to delete agent: ${message}` }, 500)
      }
    })
}
