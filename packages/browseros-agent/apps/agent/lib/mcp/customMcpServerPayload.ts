import type { McpServer } from './mcpServerStorage'

export interface ChatCustomMcpServer {
  name: string
  type?: 'http' | 'process'
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export const toChatCustomMcpServer = (
  server: McpServer,
): ChatCustomMcpServer | null => {
  if (server.type !== 'custom') return null

  const type =
    server.config?.type ?? (server.config?.command ? 'process' : 'http')
  if (type === 'process') {
    if (!server.config?.command) return null
    return {
      name: server.displayName,
      type: 'process',
      command: server.config.command,
      args: server.config.args,
      env: server.config.env,
      cwd: server.config.cwd,
    }
  }

  if (!server.config?.url) return null
  return {
    name: server.displayName,
    type: 'http',
    url: server.config.url,
    headers: server.config.headers,
  }
}

export const buildChatCustomMcpServers = (
  servers: McpServer[],
): ChatCustomMcpServer[] =>
  servers.flatMap((server) => {
    const custom = toChatCustomMcpServer(server)
    return custom ? [custom] : []
  })
