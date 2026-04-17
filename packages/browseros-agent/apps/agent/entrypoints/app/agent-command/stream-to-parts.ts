import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { AssistantPart, ToolEntry } from '@/lib/agent-conversations/types'

export function applyUiEventToParts(
  parts: AssistantPart[],
  event: UIMessageStreamEvent,
): AssistantPart[] {
  switch (event.type) {
    case 'text-start':
      return parts
    case 'text-delta':
      return upsertTextPart(parts, event.delta)
    case 'text-end':
      return parts
    case 'reasoning-start':
      return ensureThinkingPart(parts)
    case 'reasoning-delta':
      return upsertThinkingPart(parts, event.delta)
    case 'reasoning-end':
    case 'finish':
    case 'abort':
      return completeThinkingParts(parts)
    case 'tool-input-start':
      return upsertTool(parts, {
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
      })
    case 'tool-input-available':
      return upsertTool(parts, {
        id: event.toolCallId,
        name: event.toolName,
        status: 'running',
        input: event.input,
      })
    case 'tool-input-error':
      return upsertTool(parts, {
        id: event.toolCallId,
        name: readToolName(parts, event.toolCallId),
        status: 'error',
        errorText: event.errorText,
      })
    case 'tool-output-available':
      return upsertTool(parts, {
        id: event.toolCallId,
        name: readToolName(parts, event.toolCallId),
        status: readToolStatus(event.output),
        output: event.output,
        durationMs: readToolDuration(event.output),
      })
    case 'tool-output-error':
      return upsertTool(parts, {
        id: event.toolCallId,
        name: readToolName(parts, event.toolCallId),
        status: 'error',
        errorText: event.errorText,
      })
    case 'error':
      return [...parts, { kind: 'text', text: `Error: ${event.errorText}` }]
    default:
      return parts
  }
}

function upsertTextPart(
  parts: AssistantPart[],
  delta: string,
): AssistantPart[] {
  const last = parts[parts.length - 1]
  if (last?.kind === 'text') {
    return [
      ...parts.slice(0, -1),
      {
        ...last,
        text: `${last.text}${delta}`,
      },
    ]
  }

  return [...parts, { kind: 'text', text: delta }]
}

function ensureThinkingPart(parts: AssistantPart[]): AssistantPart[] {
  const last = parts[parts.length - 1]
  if (last?.kind === 'thinking' && !last.done) {
    return parts
  }

  return [...parts, { kind: 'thinking', text: '', done: false }]
}

function upsertThinkingPart(
  parts: AssistantPart[],
  delta: string,
): AssistantPart[] {
  const nextParts = ensureThinkingPart(parts)
  const last = nextParts[nextParts.length - 1]
  if (!last || last.kind !== 'thinking') {
    return nextParts
  }

  return [
    ...nextParts.slice(0, -1),
    {
      ...last,
      text: `${last.text}${delta}`,
      done: false,
    },
  ]
}

function completeThinkingParts(parts: AssistantPart[]): AssistantPart[] {
  return parts.map((part) =>
    part.kind === 'thinking' ? { ...part, done: true } : part,
  )
}

function upsertTool(parts: AssistantPart[], tool: ToolEntry): AssistantPart[] {
  const batchIndex = findToolBatchIndex(parts)
  if (batchIndex < 0) {
    return [...parts, { kind: 'tool-batch', tools: [tool] }]
  }

  const batch = parts[batchIndex]
  if (!batch || batch.kind !== 'tool-batch') {
    return parts
  }

  const existingIndex = batch.tools.findIndex((entry) => entry.id === tool.id)
  if (existingIndex < 0) {
    return [
      ...parts.slice(0, batchIndex),
      { ...batch, tools: [...batch.tools, tool] },
      ...parts.slice(batchIndex + 1),
    ]
  }

  const existing = batch.tools[existingIndex]
  const nextTool: ToolEntry = {
    ...existing,
    ...tool,
    name: tool.name || existing.name,
    input:
      tool.input === undefined
        ? existing.input
        : mergeValue(existing.input, tool.input),
    output:
      tool.output === undefined
        ? existing.output
        : mergeValue(existing.output, tool.output),
    errorText: tool.errorText ?? existing.errorText,
    durationMs: tool.durationMs ?? existing.durationMs,
  }

  return [
    ...parts.slice(0, batchIndex),
    {
      ...batch,
      tools: [
        ...batch.tools.slice(0, existingIndex),
        nextTool,
        ...batch.tools.slice(existingIndex + 1),
      ],
    },
    ...parts.slice(batchIndex + 1),
  ]
}

function findToolBatchIndex(parts: AssistantPart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.kind === 'tool-batch') {
      return index
    }
  }

  return -1
}

function readToolName(parts: AssistantPart[], toolCallId: string): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.kind !== 'tool-batch') {
      continue
    }

    const tool = part.tools.find((entry) => entry.id === toolCallId)
    if (tool) {
      return tool.name
    }
  }

  return 'unknown'
}

function readToolStatus(output: unknown): ToolEntry['status'] {
  if (
    output &&
    typeof output === 'object' &&
    'status' in output &&
    (output.status === 'completed' || output.status === 'error')
  ) {
    return output.status
  }

  return 'running'
}

function readToolDuration(output: unknown): number | undefined {
  if (
    output &&
    typeof output === 'object' &&
    'durationMs' in output &&
    typeof output.durationMs === 'number'
  ) {
    return output.durationMs
  }

  return undefined
}

function mergeValue(current: unknown, next: unknown): unknown {
  if (isObject(current) && isObject(next)) {
    return { ...current, ...next }
  }

  return next
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
