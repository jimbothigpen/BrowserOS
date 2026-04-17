import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { OpenClawStreamEvent } from '../openclaw/openclaw-types'

const OPENCLAW_TEXT_STREAM_ID_SUFFIX = 'text'
const OPENCLAW_REASONING_STREAM_ID_SUFFIX = 'reasoning'
const OPENCLAW_TOOL_NAME_FALLBACK = 'openclaw-tool'

export function normalizeOpenClawStream(
  stream: ReadableStream<OpenClawStreamEvent>,
  runtimeAgentId: string,
): ReadableStream<UIMessageStreamEvent> {
  const textId = `${runtimeAgentId}-${OPENCLAW_TEXT_STREAM_ID_SUFFIX}`
  const reasoningId = `${runtimeAgentId}-${OPENCLAW_REASONING_STREAM_ID_SUFFIX}`

  return new ReadableStream<UIMessageStreamEvent>({
    async start(controller) {
      controller.enqueue({ type: 'start' })
      controller.enqueue({ type: 'text-start', id: textId })

      const reader = stream.getReader()
      let closed = false
      const state: OpenClawNormalizationState = {
        reasoningStarted: false,
        toolCallCounter: 0,
        pendingFallbackToolCallId: null,
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || closed) {
            break
          }

          closed = handleOpenClawEvent(
            value,
            controller,
            textId,
            reasoningId,
            state,
          )
        }
      } finally {
        reader.releaseLock()
        if (!closed) {
          closeReasoningStreamIfNeeded(controller, reasoningId, state)
          controller.enqueue({ type: 'text-end', id: textId })
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        }
      }
    },
  })
}

interface OpenClawNormalizationState {
  reasoningStarted: boolean
  toolCallCounter: number
  pendingFallbackToolCallId: string | null
}

function handleOpenClawEvent(
  event: OpenClawStreamEvent,
  controller: ReadableStreamDefaultController<UIMessageStreamEvent>,
  textId: string,
  reasoningId: string,
  state: OpenClawNormalizationState,
): boolean {
  switch (event.type) {
    case 'text-delta': {
      const delta = typeof event.data.text === 'string' ? event.data.text : ''
      if (delta) {
        controller.enqueue({
          type: 'text-delta',
          id: textId,
          delta,
        })
      }
      return false
    }
    case 'thinking': {
      const delta = readNarrativeDelta(event.data)
      if (delta) {
        ensureReasoningStream(controller, reasoningId, state)
        controller.enqueue({
          type: 'reasoning-delta',
          id: reasoningId,
          delta,
        })
      }
      return false
    }
    case 'tool-start': {
      const toolCallId = resolveToolCallId(event.data, state, textId, 'start')
      const toolName = resolveToolName(event.data)

      controller.enqueue({
        type: 'tool-input-start',
        toolCallId,
        toolName,
      })

      if ('input' in event.data) {
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId,
          toolName,
          input: event.data.input,
        })
      }
      return false
    }
    case 'tool-output': {
      controller.enqueue({
        type: 'tool-output-available',
        toolCallId: resolveToolCallId(event.data, state, textId, 'output'),
        output: 'output' in event.data ? event.data.output : event.data,
      })
      return false
    }
    case 'tool-end': {
      controller.enqueue({
        type: 'tool-output-available',
        toolCallId: resolveToolCallId(event.data, state, textId, 'end'),
        output: stripToolMetadata(event.data),
      })
      return false
    }
    case 'lifecycle': {
      ensureReasoningStream(controller, reasoningId, state)
      controller.enqueue({
        type: 'reasoning-delta',
        id: reasoningId,
        delta: JSON.stringify(event.data),
      })
      return false
    }
    case 'done':
      closeReasoningStreamIfNeeded(controller, reasoningId, state)
      controller.enqueue({ type: 'text-end', id: textId })
      controller.enqueue({ type: 'finish', finishReason: 'stop' })
      controller.close()
      return true
    case 'error':
      closeReasoningStreamIfNeeded(controller, reasoningId, state)
      controller.enqueue({
        type: 'error',
        errorText:
          typeof event.data.message === 'string'
            ? event.data.message
            : 'OpenClaw chat stream failed',
      })
      controller.close()
      return true
    default:
      return false
  }
}

function ensureReasoningStream(
  controller: ReadableStreamDefaultController<UIMessageStreamEvent>,
  reasoningId: string,
  state: OpenClawNormalizationState,
): void {
  if (state.reasoningStarted) {
    return
  }

  controller.enqueue({
    type: 'reasoning-start',
    id: reasoningId,
  })
  state.reasoningStarted = true
}

function closeReasoningStreamIfNeeded(
  controller: ReadableStreamDefaultController<UIMessageStreamEvent>,
  reasoningId: string,
  state: OpenClawNormalizationState,
): void {
  if (!state.reasoningStarted) {
    return
  }

  controller.enqueue({
    type: 'reasoning-end',
    id: reasoningId,
  })
  state.reasoningStarted = false
}

function readNarrativeDelta(data: Record<string, unknown>): string {
  const candidate = data.text ?? data.message ?? data.content
  return typeof candidate === 'string' ? candidate : JSON.stringify(data)
}

function resolveToolCallId(
  data: Record<string, unknown>,
  state: OpenClawNormalizationState,
  prefix: string,
  kind: 'start' | 'output' | 'end',
): string {
  if (typeof data.toolCallId === 'string' && data.toolCallId) {
    if (kind === 'end') {
      state.pendingFallbackToolCallId = null
    }
    return data.toolCallId
  }

  if (kind === 'start' || !state.pendingFallbackToolCallId) {
    state.toolCallCounter += 1
    state.pendingFallbackToolCallId = `${prefix}-tool-${state.toolCallCounter}`
  }

  const toolCallId = state.pendingFallbackToolCallId
  if (kind === 'end') {
    state.pendingFallbackToolCallId = null
  }
  return toolCallId
}

function resolveToolName(data: Record<string, unknown>): string {
  const candidate = data.toolName ?? data.name
  return typeof candidate === 'string' && candidate
    ? candidate
    : OPENCLAW_TOOL_NAME_FALLBACK
}

function stripToolMetadata(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...data }
  delete output.toolCallId
  delete output.toolName
  delete output.name
  return output
}
