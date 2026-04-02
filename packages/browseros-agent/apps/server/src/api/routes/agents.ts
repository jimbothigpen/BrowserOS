/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent management routes for OpenClaw container instances.
 * Uses named Docker volumes for secure internal persistence.
 * User workspace is the only host directory exposed to the container.
 * Provides SSE log streaming for real-time setup visibility.
 * Persists agent metadata to ~/.browseros/agents.json.
 */

import fs from 'node:fs'
import os from 'node:os'
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
  workspacePath: string
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

function getDefaultWorkspacePath(agentName: string): string {
  return path.join(os.homedir(), 'Documents', 'BrowserOS Agents', agentName)
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

// ─── Generators ─────────────────────────────────────────────────────────────

function generateComposeFile(config: {
  image: string
  gatewayPort: number
  token: string
  homeVolumeName: string
  workspacePath: string
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
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ${config.homeVolumeName}:/home/node
      - ${config.workspacePath}:/workspace
    command: node dist/index.js gateway --bind lan --port 18789
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:18789/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

volumes:
  ${config.homeVolumeName}:
`
}

function generateOpenClawConfig(config: {
  port: number
  browserosServerPort: number
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
    mcp: {
      servers: {
        browseros: {
          url: `http://host.docker.internal:${config.browserosServerPort}/mcp`,
          transport: 'streamable-http',
        },
      },
    },
  }

  if (!config.apiKey || !config.providerType) {
    return openclawConfig
  }

  const directEnvVar = OPENCLAW_PROVIDER_ENV_MAP[config.providerType]

  if (directEnvVar) {
    openclawConfig.env = { [directEnvVar]: config.apiKey }
    if (config.modelId) {
      openclawConfig.agents = {
        defaults: {
          model: { primary: `${config.providerType}/${config.modelId}` },
        },
      }
    }
  } else if (config.baseUrl) {
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

function generateSoulMd(): string {
  const lines = [
    '# SOUL.md',
    '',
    'You are an AI assistant running inside BrowserOS.',
    '',
    '## Core Truths',
    '- **Results Over Process** — Do not explain what you are going to do. Just do it.',
    '- **Ownership** — When you take on a task, you own it end-to-end.',
    '- **Output Goes to /workspace** — All reports, documents, and files you create for the user MUST be saved to /workspace. This is the only directory the user can see from their computer.',
    '',
    '## Environment',
    '- You are running inside a Docker container managed by BrowserOS',
    '- Your internal workspace is at ~/.openclaw/workspace (for your own notes and memory)',
    '- The output directory is mounted at /workspace — save all deliverables here',
    '- You have access to BrowserOS MCP tools for web browsing, taking screenshots, filling forms, and accessing 40+ connected apps (Gmail, Slack, Notion, GitHub, etc.)',
    '',
    '## Boundaries',
    '- Do NOT attempt to access the host filesystem outside /workspace',
    '- Do NOT modify your own configuration files',
    '- Save internal notes to ~/.openclaw/workspace/memory/ (your private memory)',
    '- Save user-facing output to /workspace (their computer)',
    '',
    '## Vibe',
    '- Direct, concise, helpful',
    '- When asked to produce a report or document, write it to /workspace and tell the user the filename',
    '- When you need web data or app data, use the BrowserOS MCP tools',
    '',
  ]
  return lines.join('\n')
}

function generateAgentsMd(): string {
  const lines = [
    '# AGENTS.md',
    '',
    '## Output Directory',
    'All files intended for the user (reports, documents, exports, analysis) must be written to:',
    '```',
    '/workspace/',
    '```',
    'This directory is visible on the user host computer. Files saved here appear immediately in their chosen folder.',
    '',
    '## Internal Directory',
    'Your internal working files (memory, notes, drafts) go to:',
    '```',
    '~/.openclaw/workspace/',
    '```',
    'This is your private workspace inside the container.',
    '',
    '## Available Tools',
    '',
    '### BrowserOS MCP (web and apps)',
    'You have access to BrowserOS tools via MCP:',
    '- **Browser automation**: navigate pages, click, fill forms, take screenshots, extract content',
    '- **Connected apps**: Gmail, Slack, Notion, GitHub, Linear, Google Docs, and 40+ more',
    '- Use these tools when you need data from the web or from the user connected applications',
    '',
    '### File System',
    '- Read and write files in /workspace (user output) and ~/.openclaw/workspace (internal)',
    '- Install tools via apt or npm if needed (persists across restarts)',
    '',
    '### Memory',
    '- Save important facts to MEMORY.md (loaded every session)',
    '- Save daily context to memory/YYYY-MM-DD.md',
    '',
  ]
  return lines.join('\n')
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

// ─── Routes ─────────────────────────────────────────────────────────────────

export function createAgentsRoutes(config: { serverPort: number }) {
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
        modelId?: string
        providerName?: string
        workspacePath?: string
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
      const homeVolumeName = `browseros-claw-${name}-home`
      const workspacePath =
        body.workspacePath?.trim() || getDefaultWorkspacePath(name)

      const instance: AgentInstance = {
        id,
        name,
        status: 'creating',
        port,
        dir: agentDir,
        token,
        createdAt: new Date().toISOString(),
        providerType: body.providerType,
        workspacePath,
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
        workspacePath,
      })

      // Set up and start in the background
      ;(async () => {
        try {
          // Create agent dir and workspace on host
          fs.mkdirSync(agentDir, { recursive: true })
          fs.mkdirSync(workspacePath, { recursive: true })
          pushLog(instance, 'Created agent directories')

          // Generate docker-compose.yml (named volume + workspace bind mount)
          const composeContent = generateComposeFile({
            image: OPENCLAW_IMAGE,
            gatewayPort: port,
            token,
            homeVolumeName,
            workspacePath,
          })
          fs.writeFileSync(
            path.join(agentDir, 'docker-compose.yml'),
            composeContent,
          )
          pushLog(instance, 'Generated docker-compose.yml')

          // Generate config files to inject via docker cp
          const tmpDir = path.join(agentDir, '.tmp')
          fs.mkdirSync(tmpDir, { recursive: true })

          const openclawConfig = generateOpenClawConfig({
            port,
            browserosServerPort: config.serverPort,
            providerType: body.providerType,
            apiKey: body.apiKey,
            baseUrl: body.baseUrl,
            modelId: body.modelId,
            providerName: body.providerName,
          })
          fs.writeFileSync(
            path.join(tmpDir, 'openclaw.json'),
            JSON.stringify(openclawConfig, null, 2),
          )

          fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), generateSoulMd())
          fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), generateAgentsMd())
          pushLog(instance, 'Generated configuration files')

          // Pull image
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

          // Start container — it will crash because config is missing, but
          // this initializes the named volume with the correct directory
          // structure and ownership (uid 1000 node user)
          pushLog(instance, 'Initializing container...')
          await runCommandWithLogs(
            instance,
            'docker',
            ['compose', 'up', '-d'],
            { cwd: agentDir, env: composeEnv(name) },
          )

          // Wait for the container to start and init the volume
          pushLog(instance, '[debug] Waiting 3s for volume initialization...')
          await Bun.sleep(3000)

          const containerName = `browseros-claw-${name}-openclaw-gateway-1`

          // Debug: check container status
          pushLog(instance, '[debug] Checking container status...')
          await runCommandWithLogs(instance, 'docker', [
            'inspect',
            '--format',
            '{{.State.Status}} {{.State.Running}}',
            containerName,
          ])

          // Debug: list what's in /home/node inside the container
          pushLog(instance, '[debug] Listing /home/node in container...')
          await runCommandWithLogs(instance, 'docker', [
            'exec',
            containerName,
            'ls',
            '-la',
            '/home/node/',
          ])

          // Debug: check if .openclaw exists
          pushLog(instance, '[debug] Listing /home/node/.openclaw...')
          await runCommandWithLogs(instance, 'docker', [
            'exec',
            containerName,
            'ls',
            '-la',
            '/home/node/.openclaw/',
          ])

          // Debug: check the volume mounts
          pushLog(instance, '[debug] Checking volume mounts...')
          await runCommandWithLogs(instance, 'docker', [
            'inspect',
            '--format',
            '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}\n{{end}}',
            containerName,
          ])

          // Debug: show container logs so far
          pushLog(instance, '[debug] Container logs so far...')
          await runCommandWithLogs(instance, 'docker', [
            'logs',
            '--tail',
            '10',
            containerName,
          ])

          // Debug: check tmp files on host
          pushLog(instance, `[debug] Temp files on host: ${tmpDir}`)
          const tmpFiles = fs.readdirSync(tmpDir)
          pushLog(instance, `[debug] Files in tmpDir: ${tmpFiles.join(', ')}`)

          // Inject config via docker cp
          pushLog(instance, 'Injecting configuration...')

          for (const [src, dest] of [
            ['openclaw.json', '/home/node/.openclaw/openclaw.json'],
            ['SOUL.md', '/home/node/.openclaw/workspace/SOUL.md'],
            ['AGENTS.md', '/home/node/.openclaw/workspace/AGENTS.md'],
          ]) {
            pushLog(
              instance,
              `[debug] docker cp ${src} -> ${containerName}:${dest}`,
            )
            const cpExit = await runCommandWithLogs(instance, 'docker', [
              'cp',
              path.join(tmpDir, src),
              `${containerName}:${dest}`,
            ])
            if (cpExit !== 0) {
              throw new Error(`Failed to inject ${src}`)
            }
          }

          // Fix ownership
          await runCommandWithLogs(instance, 'docker', [
            'exec',
            containerName,
            'chown',
            '-R',
            'node:node',
            '/home/node/.openclaw',
          ])

          // Clean up temp files
          fs.rmSync(tmpDir, { recursive: true, force: true })
          pushLog(instance, 'Configuration injected')

          // Restart so the gateway picks up the new config
          pushLog(instance, 'Starting OpenClaw gateway...')
          await runCommandWithLogs(instance, 'docker', ['compose', 'restart'], {
            cwd: agentDir,
            env: composeEnv(name),
          })

          // Wait for health check
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
          pushLog(instance, `Output workspace: ${workspacePath}`)
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
            workspacePath,
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

        // down -v removes the named volume too
        await runCommandWithLogs(
          instance,
          'docker',
          ['compose', 'down', '-v'],
          { cwd: instance.dir, env: composeEnv(instance.name) },
        )
        // Remove compose file dir (NOT the user's workspace)
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
