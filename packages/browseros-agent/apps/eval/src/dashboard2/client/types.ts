import type { LLMProvider } from '@browseros/shared/schemas/llm'
import type { GraderResult } from '../../types/result'

export type Tab = 'live' | 'history'
export type RunState = 'idle' | 'running' | 'done'

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'

export interface ConfigForm {
  provider: LLMProvider
  model: string
  apiKey: string
  baseUrl: string
}

export interface DashboardTask {
  queryId: string
  query: string
  startUrl?: string
  status: TaskStatus
  durationMs?: number
  graderResults?: Record<string, GraderResult>
  screenshotCount: number
}

export interface StreamEvent {
  type: string
  taskId: string
  timestamp?: string
  screenshot?: number
  status?: TaskStatus
  durationMs?: number
  graderResults?: Record<string, GraderResult>
  screenshotCount?: number
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  errorText?: string
  error?: unknown
  delta?: string
  id?: string
  message?: string
  [key: string]: unknown
}

export interface ApiStateResponse {
  configName: string
  agentType: string
  running: boolean
  tasks: DashboardTask[]
}

export interface RunResponse {
  status: string
  taskCount: number
  outputDir: string
}

export interface LoadRunResponse {
  status: string
  configName: string
  agentType: string
  taskCount: number
  tasks: DashboardTask[]
}

export interface ApiErrorResponse {
  error: string
  details?: string[]
}
