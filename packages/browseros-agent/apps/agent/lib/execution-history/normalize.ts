import type { DynamicToolUIPart, ToolUIPart, UIMessage } from 'ai'
import type { ExecutionStepRecord, ExecutionStepState } from './types'

const NUDGE_TOOL_NAMES = new Set(['suggest_schedule', 'suggest_app_connection'])
const TERMINAL_STEP_STATES = new Set<ExecutionStepState>([
  'output-available',
  'output-error',
])
const MAX_PREVIEW_CHARS = 180

type ToolLikePart = ToolUIPart | DynamicToolUIPart

function truncateText(value: string): string {
  if (value.length <= MAX_PREVIEW_CHARS) return value
  return `${value.slice(0, MAX_PREVIEW_CHARS - 3)}...`
}

function getToolName(part: ToolLikePart): string {
  if (part.type === 'dynamic-tool') {
    return part.toolName
  }

  return part.type.replace('tool-', '')
}

function isToolPart(part: UIMessage['parts'][number]): part is ToolLikePart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function isExecutionToolPart(
  part: UIMessage['parts'][number],
): part is ToolLikePart {
  if (!isToolPart(part)) return false
  return !NUDGE_TOOL_NAMES.has(getToolName(part))
}

function getPreviewText(part: ToolLikePart): string {
  if (part.state === 'output-error') {
    return 'Action failed'
  }

  if (part.state === 'output-available') {
    return 'Completed successfully'
  }

  if (part.state === 'input-available') {
    return 'Action running'
  }

  return 'Preparing action'
}

function getCompletedAt(
  existingStep: ExecutionStepRecord | undefined,
  state: ExecutionStepState,
  nowIso: string,
): string | undefined {
  if (existingStep?.completedAt) return existingStep.completedAt
  if (!TERMINAL_STEP_STATES.has(state)) return undefined
  return nowIso
}

function createStepRecord(
  part: ToolLikePart,
  order: number,
  nowIso: string,
  existingStep?: ExecutionStepRecord,
): ExecutionStepRecord {
  const state = part.state as ExecutionStepState
  return {
    id: part.toolCallId,
    toolName: getToolName(part),
    order,
    state,
    startedAt: existingStep?.startedAt ?? nowIso,
    completedAt: getCompletedAt(existingStep, state, nowIso),
    input: part.input,
    output: 'output' in part ? part.output : undefined,
    errorText: 'errorText' in part ? part.errorText : undefined,
    previewText: getPreviewText(part),
  }
}

export function getMessageText(
  message?: Pick<UIMessage, 'parts'> | null,
): string {
  if (!message) return ''

  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}

export function getResponsePreview(message?: Pick<UIMessage, 'parts'> | null) {
  return truncateText(getMessageText(message))
}

export function normalizeExecutionSteps(args: {
  assistantMessage?: UIMessage | null
  previousSteps?: ExecutionStepRecord[]
  nowIso: string
}) {
  const { assistantMessage, previousSteps = [], nowIso } = args
  const previousStepsById = new Map(
    previousSteps.map((step) => [step.id, step]),
  )

  const steps = assistantMessage
    ? assistantMessage.parts.flatMap((part, index) => {
        if (!isExecutionToolPart(part)) return []
        const existingStep = previousStepsById.get(part.toolCallId)
        return [createStepRecord(part, index, nowIso, existingStep)]
      })
    : []

  return {
    assistantMessageId: assistantMessage?.id,
    steps,
    actionCount: steps.length,
    errorCount: steps.filter((step) => step.state === 'output-error').length,
  }
}
