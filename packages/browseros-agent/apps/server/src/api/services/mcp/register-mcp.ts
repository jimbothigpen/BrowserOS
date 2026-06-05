import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'
import {
  executeTool,
  type ToolContext,
  type ToolDefinition,
} from '../../../tools/framework'
import type { ToolRegistry } from '../../../tools/tool-registry'

// True when the tool's zod input schema is a ZodObject with the given
// optional field. Schema-driven so any future tool that adds the same
// field participates automatically — no per-tool allowlist.
function inputHasField(tool: ToolDefinition, field: string): boolean {
  const input = tool.input
  if (!(input instanceof z.ZodObject)) return false
  return field in (input as z.AnyZodObject).shape
}

// Tools whose only purpose is to mutate the window topology — agents
// in single-window mode (i.e., the host pinned defaultWindowId) must
// not call these, or they'd break the host's invariant.
const SINGLE_WINDOW_BLOCKED_TOOLS = new Set([
  'create_window',
  'create_hidden_window',
  'close_window',
  'set_window_visibility',
])

export function registerTools(
  mcpServer: McpServer,
  registry: ToolRegistry,
  ctx: ToolContext & {
    // Default windowId from X-BrowserOS-Default-Window-Id. When set,
    // tool calls without an explicit args.windowId have this value
    // injected — provided the tool's schema actually accepts one. When
    // set, window-mutating tools are also filtered out — see
    // SINGLE_WINDOW_BLOCKED_TOOLS.
    defaultWindowId?: number
    // Default tabGroupId from X-BrowserOS-Default-Tab-Group-Id. Same
    // injection pattern as defaultWindowId, applied to tools whose
    // schema accepts tabGroupId (new_page, new_hidden_page, show_page,
    // move_page today).
    defaultTabGroupId?: string
  },
): void {
  const singleWindowMode = ctx.defaultWindowId !== undefined
  for (const tool of registry.all()) {
    if (singleWindowMode && SINGLE_WINDOW_BLOCKED_TOOLS.has(tool.name)) continue
    const acceptsWindowId = inputHasField(tool, 'windowId')
    const acceptsTabGroupId = inputHasField(tool, 'tabGroupId')
    const handler = async (
      args: Record<string, unknown>,
      extra: { signal: AbortSignal },
    ) => {
      // Inject the per-request default windowId only when (a) the host
      // supplied one via header, (b) the tool actually accepts a
      // windowId, and (c) the caller didn't explicitly set one. The
      // explicit-set check means an agent that *did* pick a windowId on
      // purpose still wins — we only fill the gap.
      if (
        ctx.defaultWindowId !== undefined &&
        acceptsWindowId &&
        args.windowId === undefined
      ) {
        args.windowId = ctx.defaultWindowId
      }
      if (
        ctx.defaultTabGroupId !== undefined &&
        acceptsTabGroupId &&
        args.tabGroupId === undefined
      ) {
        args.tabGroupId = ctx.defaultTabGroupId
      }
      const startTime = performance.now()

      try {
        logger.info(`${tool.name} request: ${JSON.stringify(args, null, '  ')}`)

        const result = await executeTool(tool, args, ctx, extra.signal)

        metrics.log('tool_executed', {
          tool_name: tool.name,
          duration_ms: Math.round(performance.now() - startTime),
          success: !result.isError,
          source: 'mcp',
        })

        return {
          content: result.content,
          isError: result.isError,
          structuredContent: result.structuredContent,
        }
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error)

        metrics.log('tool_executed', {
          tool_name: tool.name,
          duration_ms: Math.round(performance.now() - startTime),
          success: false,
          error_message: errorText,
          source: 'mcp',
        })

        return {
          content: [{ type: 'text' as const, text: errorText }],
          isError: true,
        }
      }
    }

    mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input as unknown as Record<string, never>,
        outputSchema: tool.output as unknown as Record<string, never>,
      },
      handler,
    )
  }

  logger.info(
    `Registered ${registry.names().length} tools: ${registry.names().join(', ')}`,
  )
}
