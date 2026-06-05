/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Browser } from '../../../browser/browser'
import type { ToolRegistry } from '../../../tools/tool-registry'
import {
  type KlavisProxyRef,
  registerKlavisTools,
} from '../klavis/strata-proxy'
import { MCP_INSTRUCTIONS } from './mcp-prompt'
import { registerTools } from './register-mcp'

export interface McpServiceDeps {
  version: string
  registry: ToolRegistry
  browser: Browser
  executionDir: string
  resourcesDir: string
  klavisRef?: KlavisProxyRef
  // Per-request default windowId from the X-BrowserOS-Default-Window-Id
  // header. When set, tool handlers inject this into args.windowId for
  // any tool whose zod input schema has a `windowId` field and whose
  // caller-supplied args didn't include one. Lets a host application
  // bind every browser tool call to a specific window without the
  // agent needing to be aware of it.
  defaultWindowId?: number
  // Same pattern for tab groups, via X-BrowserOS-Default-Tab-Group-Id.
  // Tools that accept `tabGroupId` (currently new_page, new_hidden_page,
  // show_page, move_page) get this auto-injected so every tab a given
  // agent opens lands in that agent's group without explicit routing.
  defaultTabGroupId?: string
}

export function createMcpServer(deps: McpServiceDeps): McpServer {
  const server = new McpServer(
    {
      name: 'browseros_mcp',
      title: 'BrowserOS MCP server',
      version: deps.version,
    },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
  )

  server.server.setRequestHandler(SetLevelRequestSchema, () => {
    return {}
  })

  registerTools(server, deps.registry, {
    browser: deps.browser,
    directories: {
      workingDir: deps.executionDir,
      resourcesDir: deps.resourcesDir,
    },
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  })

  if (deps.klavisRef?.handle) {
    registerKlavisTools(server, deps.klavisRef.handle)
  }

  return server
}
