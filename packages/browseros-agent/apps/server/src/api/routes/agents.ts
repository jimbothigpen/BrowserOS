/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent management routes for OpenClaw Docker instances.
 * Generates docker-compose.yml directly and uses docker compose for lifecycle.
 * Provides SSE log streaming for real-time setup visibility.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { logger } from '../../lib/logger'

const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest'
const MAX_LOG_LINES = 1000

interface AgentInstance {
  id: string
  name: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  port: number
  dir: string
  createdAt: string
  error?: string
  logs: string[]
  logListeners: Set<(line: string) => void>
}

function getAgentsBaseDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return path.join(home, '.browseros', 'agents')
}

const instances = new Map<string, AgentInstance>()

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
  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    tag: string,
  ) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) {
          pushLog(instance, `[${tag}] ${line}`)
        }
      }
    }
    if (buffer.trim()) {
      pushLog(instance, `[${tag}] ${buffer}`)
    }
  }

  await Promise.all([
    readStream(proc.stdout as ReadableStream<Uint8Array>, prefix),
    readStream(proc.stderr as ReadableStream<Uint8Array>, `${prefix}:err`),
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

        // Replay existing logs
        for (const line of instance.logs) {
          await write(line)
        }

        // Subscribe to new logs
        const onLog = (line: string) => {
          write(line).catch(() => {
            instance.logListeners.delete(onLog)
          })
        }
        instance.logListeners.add(onLog)

        // Keep connection alive until client disconnects
        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            instance.logListeners.delete(onLog)
            resolve()
          })
        })
      })
    })

    .post('/create', async (c) => {
      const body = await c.req.json<{ name: string }>()
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

      const instance: AgentInstance = {
        id,
        name,
        status: 'creating',
        port,
        dir: agentDir,
        createdAt: new Date().toISOString(),
        logs: [],
        logListeners: new Set(),
      }
      instances.set(id, instance)

      logger.info('Creating OpenClaw agent instance', {
        id,
        name,
        port,
        dir: agentDir,
      })

      // Set up and start in the background
      ;(async () => {
        try {
          // Create directories
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

          // Pull image
          pushLog(instance, `Pulling image ${OPENCLAW_IMAGE}...`)
          const pullExit = await runCommandWithLogs(
            instance,
            'docker',
            ['compose', 'pull', '--quiet'],
            {
              cwd: agentDir,
              env: { COMPOSE_PROJECT_NAME: `browseros-claw-${name}` },
            },
          )
          if (pullExit !== 0) {
            throw new Error('Failed to pull OpenClaw image')
          }
          pushLog(instance, 'Image pulled successfully')

          // Start containers
          pushLog(instance, 'Starting OpenClaw gateway...')
          const upExit = await runCommandWithLogs(
            instance,
            'docker',
            ['compose', 'up', '-d'],
            {
              cwd: agentDir,
              env: { COMPOSE_PROJECT_NAME: `browseros-claw-${name}` },
            },
          )
          if (upExit !== 0) {
            throw new Error('Failed to start OpenClaw containers')
          }

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
            // Dump container logs to help debug
            pushLog(instance, '--- Container logs ---')
            await runCommandWithLogs(
              instance,
              'docker',
              ['compose', 'logs', '--no-color', '--tail', '50'],
              {
                cwd: agentDir,
                env: { COMPOSE_PROJECT_NAME: `browseros-claw-${name}` },
              },
            )
            pushLog(instance, '--- End container logs ---')
            throw new Error('Gateway did not become healthy within 30 seconds')
          }

          pushLog(
            instance,
            `OpenClaw gateway is ready at ws://127.0.0.1:${port}`,
          )
          pushLog(instance, `Control UI available at http://127.0.0.1:${port}`)
          instance.status = 'running'
          logger.info('OpenClaw agent instance started', { id, name, port })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          pushLog(instance, `ERROR: ${message}`)
          // Also fetch container logs on any error if the compose file exists
          try {
            if (fs.existsSync(path.join(agentDir, 'docker-compose.yml'))) {
              pushLog(instance, '--- Container logs ---')
              await runCommandWithLogs(
                instance,
                'docker',
                ['compose', 'logs', '--no-color', '--tail', '50'],
                {
                  cwd: agentDir,
                  env: { COMPOSE_PROJECT_NAME: `browseros-claw-${name}` },
                },
              )
              pushLog(instance, '--- End container logs ---')
            }
          } catch {
            // Best effort — don't mask the original error
          }
          instance.status = 'error'
          instance.error = message
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
          env: { COMPOSE_PROJECT_NAME: `browseros-claw-${instance.name}` },
        })
        instance.status = 'stopped'
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
          env: {
            COMPOSE_PROJECT_NAME: `browseros-claw-${instance.name}`,
          },
        })
        instance.status = 'running'
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

    .delete('/:id', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      try {
        // Close all log listeners
        for (const listener of instance.logListeners) {
          instance.logListeners.delete(listener)
        }

        // Stop and remove containers + volumes via compose
        await runCommandWithLogs(
          instance,
          'docker',
          ['compose', 'down', '-v'],
          {
            cwd: instance.dir,
            env: {
              COMPOSE_PROJECT_NAME: `browseros-claw-${instance.name}`,
            },
          },
        )
        // Clean up agent directory
        fs.rmSync(instance.dir, { recursive: true, force: true })
        instances.delete(id)
        return c.json({ success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to delete agent: ${message}` }, 500)
      }
    })
}
