import type { Message } from '../../types'

interface AgentResponse {
  task_type: string
  status: 'completed' | 'failed'
  retrieved_data: string | null
}

/**
 * Build the agent_response.json required by WebArena-Verified's evaluator.
 *
 * The evaluator expects:
 * - task_type: "action" or "information_retrieval"
 * - status: whether the agent completed the task
 * - retrieved_data: the agent's final answer (for information retrieval tasks)
 *
 * The task_type is determined from the task metadata if available,
 * otherwise defaults to "action".
 */
export function buildAgentResponse(
  finalAnswer: string | null,
  _messages: Message[],
  taskType?: string,
): AgentResponse {
  return {
    task_type: taskType || 'action',
    status: finalAnswer ? 'completed' : 'failed',
    retrieved_data: finalAnswer || null,
  }
}
