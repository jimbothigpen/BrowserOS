export type ExecutionTaskStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'

export type ExecutionStepState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'

export interface ExecutionStepRecord {
  id: string
  toolName: string
  order: number
  state: ExecutionStepState
  startedAt: string
  completedAt?: string
  input?: unknown
  output?: unknown
  errorText?: string
  previewText: string
}

export interface ExecutionTaskRecord {
  id: string
  conversationId: string
  promptText: string
  promptMessageId?: string
  assistantMessageId?: string
  startedAt: string
  completedAt?: string
  status: ExecutionTaskStatus
  responseText?: string
  responsePreview?: string
  actionCount: number
  errorCount: number
  steps: ExecutionStepRecord[]
}

export interface ConversationExecutionHistory {
  conversationId: string
  updatedAt: number
  tasks: ExecutionTaskRecord[]
}

export type ExecutionHistoryByConversation = Record<
  string,
  ConversationExecutionHistory
>
