import { z } from 'zod'

export const RawTaskSchema = z.object({
  query_id: z.string(),
  query: z.string(),
  dataset: z.string(),
  start_url: z.string().optional(),
})

export const TaskSchema = z.object({
  queryId: z.string(),
  query: z.string(),
  dataset: z.string(),
  startUrl: z.string().optional(),
})

export type RawTask = z.infer<typeof RawTaskSchema>
export type Task = z.infer<typeof TaskSchema>

export interface UserMessage {
  type: 'user'
  content: string
}

export interface ToolInputMessage {
  type: 'tool-input-available'
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolOutputMessage {
  type: 'tool-output-available'
  toolCallId: string
  output: unknown
}

export interface TextMessage {
  type: 'text'
  text: string
}

export type Message =
  | UserMessage
  | ToolInputMessage
  | ToolOutputMessage
  | TextMessage

export interface AgentResult {
  finalAnswer: string | null
  messages: Message[]
  terminationReason: 'done' | 'timeout' | 'error'
  toolCallCount: number
}

export interface GraderResult {
  score: number
  pass: boolean
  reasoning: string
  details?: Record<string, unknown>
}

export interface GraderInputTask {
  query_id: string
  query: string
  dataset: string
}

export interface GraderInput {
  task: GraderInputTask
  messages: Message[]
  screenshotCount: number
  finalAnswer: string | null
  expectedAnswer?: string | null
  outputDir: string
  mcpUrl?: string
}

export interface Grader {
  name: string
  grade(input: GraderInput): Promise<GraderResult>
}

export interface TaskResult {
  task: Task
  agentResult: AgentResult
  graderResult: GraderResult
  durationMs: number
  status: 'PASS' | 'FAIL'
}

export interface RunSummaryTask {
  queryId: string
  status: 'PASS' | 'FAIL'
  durationMs: number
  graderReward: number
  laminarSessionId: string | null
}

export interface RunSummary {
  runId: string
  configName: string
  model: string
  startedAt: string
  completedAt: string
  total: number
  passed: number
  failed: number
  passRate: number
  avgDurationMs: number
  tasks: RunSummaryTask[]
}
