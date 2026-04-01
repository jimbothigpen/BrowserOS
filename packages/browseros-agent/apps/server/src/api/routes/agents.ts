/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent management routes for OpenClaw Docker instances.
 * Generates docker-compose.yml directly and uses docker compose for lifecycle.
 * Provides SSE log streaming for real-time setup visibility.
 * Persists agent metadata to ~/.browseros/agents.json.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { getBrowserosDir } from '../../lib/browseros-dir'
import { logger } from '../../lib/logger'

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

async function isDockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['docker', 'info'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
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

async function streamProcessOutput(
  proc: ReturnType<typeof Bun.spawn>,
  instance: AgentInstance,
  prefix: string,
): Promise<void> {
  const seen = new Set<string>()
  const dedup =
    (tag: string) => async (readable: ReadableStream<Uint8Array>) => {
      const reader = readable.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed)
            pushLog(instance, `[${tag}] ${trimmed}`)
          }
        }
      }
      const trimmed = buf.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        pushLog(instance, `[${tag}] ${trimmed}`)
      }
    }

  await Promise.all([
    dedup(prefix)(proc.stdout as ReadableStream<Uint8Array>),
    dedup(prefix)(proc.stderr as ReadableStream<Uint8Array>),
  ])
}

async function runCommandWithLogs(
  instance: AgentInstance,
  cmd: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
  })
  await streamProcessOutput(proc, instance, cmd)
  return proc.exited
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
  extraEnv?: Array<{ envVar: string; value: string }>
}): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const envLines = [
    `      - OPENCLAW_GATEWAY_TOKEN=${config.token}`,
    `      - TZ=${tz}`,
  ]
  for (const env of config.extraEnv ?? []) {
    envLines.push(`      - ${env.envVar}=${env.value}`)
  }
  return `services:
  openclaw-gateway:
    image: ${config.image}
    ports:
      - "127.0.0.1:${config.gatewayPort}:18789"
    environment:
${envLines.join('\n')}
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
        'docker',
        ['compose', 'logs', '--no-color', '--tail', '50'],
        { cwd: agentDir, env: composeEnv(name) },
      )
      pushLog(instance, '--- End container logs ---')
    }
  } catch {
    // Best effort
  }
}

async function runConfigSet(
  instance: AgentInstance,
  agentDir: string,
  name: string,
  key: string,
  value: string,
): Promise<number> {
  return runCommandWithLogs(
    instance,
    'docker',
    [
      'compose',
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'node',
      'openclaw-gateway',
      'dist/index.js',
      'config',
      'set',
      key,
      value,
    ],
    { cwd: agentDir, env: composeEnv(name) },
  )
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

    .get('/docker-status', async (c) => {
      const available = await isDockerAvailable()
      return c.json({ available })
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

      const dockerAvailable = await isDockerAvailable()
      if (!dockerAvailable) {
        return c.json(
          {
            error:
              'Docker is not available. Install Docker Desktop or OrbStack to create local agents.',
          },
          503,
        )
      }

      const id = crypto.randomUUID()
      const port = await findAvailablePort(18789)
      const agentDir = path.join(getAgentsBaseDir(), name)
      const token = crypto.randomUUID()

      // Map BrowserOS provider to OpenClaw env vars
      const llmEnvVars: Array<{ envVar: string; value: string }> = []
      if (body.apiKey && body.providerType) {
        const directEnvVar = OPENCLAW_PROVIDER_ENV_MAP[body.providerType]
        if (directEnvVar) {
          // Direct mapping (Anthropic, OpenAI, etc.)
          llmEnvVars.push({ envVar: directEnvVar, value: body.apiKey })
        } else if (body.baseUrl) {
          // OpenAI-compatible provider — pass as OPENAI_API_KEY + OPENAI_BASE_URL
          llmEnvVars.push({ envVar: 'OPENAI_API_KEY', value: body.apiKey })
          llmEnvVars.push({ envVar: 'OPENAI_BASE_URL', value: body.baseUrl })
        }
      }

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

          const composeContent = generateComposeFile({
            image: OPENCLAW_IMAGE,
            gatewayPort: port,
            token,
            configDir,
            workspaceDir,
            extraEnv: llmEnvVars,
          })
          fs.writeFileSync(
            path.join(agentDir, 'docker-compose.yml'),
            composeContent,
          )
          pushLog(instance, 'Generated docker-compose.yml')

          pushLog(instance, `Pulling image ${OPENCLAW_IMAGE}...`)
          const pullExit = await runCommandWithLogs(
            instance,
            'docker',
            ['compose', 'pull', '--quiet'],
            { cwd: agentDir, env: composeEnv(name) },
          )
          if (pullExit !== 0) {
            throw new Error('Failed to pull OpenClaw image')
          }
          pushLog(instance, 'Image pulled successfully')

          pushLog(instance, 'Configuring gateway...')
          const modeExit = await runConfigSet(
            instance,
            agentDir,
            name,
            'gateway.mode',
            'local',
          )
          if (modeExit !== 0) {
            throw new Error('Failed to configure gateway mode')
          }

          const originsExit = await runConfigSet(
            instance,
            agentDir,
            name,
            'gateway.controlUi.allowedOrigins',
            JSON.stringify([
              `http://127.0.0.1:${port}`,
              `http://localhost:${port}`,
            ]),
          )
          if (originsExit !== 0) {
            throw new Error('Failed to configure Control UI allowed origins')
          }

          // Enable OpenAI-compatible HTTP API for chat
          const httpApiExit = await runConfigSet(
            instance,
            agentDir,
            name,
            'gateway.http.endpoints.chatCompletions.enabled',
            'true',
          )
          if (httpApiExit !== 0) {
            throw new Error('Failed to enable chat completions API')
          }
          pushLog(instance, 'Gateway configured for local mode')

          pushLog(instance, 'Starting OpenClaw gateway...')
          const upExit = await runCommandWithLogs(
            instance,
            'docker',
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
        pushLog(instance, 'Stopping agent...')
        await runCommandWithLogs(instance, 'docker', ['compose', 'stop'], {
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
        pushLog(instance, 'Starting agent...')
        await runCommandWithLogs(instance, 'docker', ['compose', 'up', '-d'], {
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
        for (const listener of instance.logListeners) {
          instance.logListeners.delete(listener)
        }

        await runCommandWithLogs(
          instance,
          'docker',
          ['compose', 'down', '-v'],
          { cwd: instance.dir, env: composeEnv(instance.name) },
        )
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
