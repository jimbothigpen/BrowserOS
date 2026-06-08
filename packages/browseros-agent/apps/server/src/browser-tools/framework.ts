import type { TypeOf, ZodType } from 'zod'
import type { BrowserSession } from '../browser/core/session'

// The new MCP tool surface over browser-core. One definition + one result envelope serves both
// the external MCP server and the internal agent (replacing the legacy double-wrapping). Handlers
// are thin: resolve args -> call the SDK -> return content. Errors never throw out of executeTool;
// they come back as an instructive, model-readable result.

export interface ToolContext {
  session: BrowserSession
  defaultWindowId?: number
  defaultTabGroupId?: string
}

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ImageBlock {
  type: 'image'
  data: string
  mimeType: string
}
export type ContentBlock = TextBlock | ImageBlock

export interface ToolResult {
  content: ContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  openWorldHint?: boolean
}

// Registry-facing (erased) shape, so heterogeneous tools collect into one ToolDefinition[].
export interface ToolDefinition {
  name: string
  description: string
  input: ZodType
  annotations?: ToolAnnotations
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>
}

// Authoring helper: handler args are typed from the schema OUTPUT (zod-defaulted fields are
// non-optional), while the returned definition is erased for the registry.
export function defineTool<S extends ZodType>(def: {
  name: string
  description: string
  input: S
  annotations?: ToolAnnotations
  handler: (args: TypeOf<S>, ctx: ToolContext) => Promise<ToolResult>
}): ToolDefinition {
  return def as unknown as ToolDefinition
}

export function textResult(text: string, structured?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured !== undefined && { structuredContent: structured }),
  }
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Validate args, run the handler, and convert any failure into an instructive error result. */
export async function executeTool(
  def: ToolDefinition,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const parsed = def.input.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return errorResult(`Invalid arguments for ${def.name}: ${detail}`)
  }

  try {
    return await def.handler(parsed.data as Record<string, unknown>, ctx)
  } catch (err) {
    return errorResult(
      `${def.name} failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
