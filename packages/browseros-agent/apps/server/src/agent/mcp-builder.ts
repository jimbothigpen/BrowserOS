import { createMCPClient } from '@ai-sdk/mcp'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ToolSet } from 'ai'
import { logger } from '../lib/logger'
import {
  detectMcpTransport,
  type McpTransportType,
} from '../lib/mcp-transport-detect'

export interface HttpMcpServerSpec {
  name: string
  type: 'http'
  url: string
  transport: McpTransportType
  headers?: Record<string, string>
}

export interface ProcessMcpServerSpec {
  name: string
  type: 'process'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type McpServerSpec = HttpMcpServerSpec | ProcessMcpServerSpec

export interface McpServerSpecDeps {
  browserContext?: BrowserContext
}

export interface McpClientBundle {
  clients: Array<{ close(): Promise<void> }>
  tools: ToolSet
}

// Build list of custom MCP server specs from browser context
// (Klavis Strata is handled separately via shared background connection)
export async function buildMcpServerSpecs(
  deps: McpServerSpecDeps,
): Promise<McpServerSpec[]> {
  const specs: McpServerSpec[] = []

  // User-provided custom MCP servers
  if (deps.browserContext?.customMcpServers?.length) {
    const servers = deps.browserContext.customMcpServers
    const httpServers: Array<{
      name: string
      url: string
      headers?: Record<string, string>
    }> = []

    for (const server of servers) {
      const name = `custom-${server.name}`
      const type = server.type ?? (server.command ? 'process' : 'http')

      if (type === 'process') {
        if (!server.command) {
          logger.warn('Skipping process MCP server without command', { name })
          continue
        }
        specs.push({
          name,
          type: 'process',
          command: server.command,
          args: server.args,
          env: server.env,
          cwd: server.cwd,
        })
        continue
      }

      if (!server.url) {
        logger.warn('Skipping HTTP MCP server without URL', { name })
        continue
      }
      httpServers.push({
        name,
        url: server.url,
        headers: server.headers,
      })
    }

    const transports = await Promise.all(
      httpServers.map((s) => detectMcpTransport(s.url)),
    )
    for (let i = 0; i < httpServers.length; i++) {
      specs.push({
        name: httpServers[i].name,
        type: 'http',
        url: httpServers[i].url,
        transport: transports[i],
        headers: httpServers[i].headers,
      })
    }
  }

  return specs
}

function resolveProcessCommand(command: string): string {
  if (process.platform === 'win32' && command.toLowerCase() === 'npx') {
    return 'npx.cmd'
  }
  return command
}

function getMcpLogContext(spec: McpServerSpec) {
  if (spec.type === 'process') {
    return {
      name: spec.name,
      type: spec.type,
      command: resolveProcessCommand(spec.command),
      args: spec.args,
      cwd: spec.cwd,
      envKeys: Object.keys(spec.env ?? {}).sort(),
    }
  }

  return {
    name: spec.name,
    type: spec.type,
    url: spec.url,
    transport: spec.transport,
  }
}

// Connect a single MCP client with timeout protection
async function connectMcpClient(
  spec: McpServerSpec,
): Promise<{ client: { close(): Promise<void> }; tools: ToolSet } | null> {
  const timeout = TIMEOUTS.MCP_CLIENT_CONNECT
  try {
    const client = await Promise.race([
      createMCPClient({
        transport:
          spec.type === 'process'
            ? new StdioClientTransport({
                command: resolveProcessCommand(spec.command),
                args: spec.args,
                env: spec.env,
                cwd: spec.cwd,
              })
            : {
                type: spec.transport === 'sse' ? 'sse' : 'http',
                url: spec.url,
                headers: spec.headers,
              },
        onUncaughtError(error) {
          logger.warn('Uncaught MCP client error', {
            ...getMcpLogContext(spec),
            error: error instanceof Error ? error.message : String(error),
          })
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`MCP client connect timed out after ${timeout}ms`),
            ),
          timeout,
        ),
      ),
    ])
    const clientTools = await Promise.race([
      client.tools(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`MCP client.tools() timed out after ${timeout}ms`),
            ),
          timeout,
        ),
      ),
    ])
    return { client, tools: clientTools }
  } catch (error) {
    logger.warn('Failed to connect MCP client, skipping', {
      ...getMcpLogContext(spec),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// Create MCP clients from specs, return merged toolset
export async function createMcpClients(
  specs: McpServerSpec[],
): Promise<McpClientBundle> {
  const clients: Array<{ close(): Promise<void> }> = []
  let tools: ToolSet = {}

  // Connect all clients concurrently with per-client timeout
  const results = await Promise.all(specs.map(connectMcpClient))
  for (const result of results) {
    if (result) {
      clients.push(result.client)
      tools = { ...tools, ...result.tools }
    }
  }

  return { clients, tools }
}
