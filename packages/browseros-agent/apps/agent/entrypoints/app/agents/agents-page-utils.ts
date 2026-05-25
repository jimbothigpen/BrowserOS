import type { HarnessAgent, HarnessAgentAdapter } from './agent-harness-types'
import type { AgentListItem } from './agents-page-types'

export function formatHarnessAdapter(adapter: HarnessAgentAdapter): string {
  if (adapter === 'claude') return 'Claude Code'
  if (adapter === 'codex') return 'Codex'
  return 'Hermes'
}

export function toHarnessListItem(agent: HarnessAgent): AgentListItem {
  return {
    key: `agent-harness:${agent.id}`,
    agentId: agent.id,
    name: agent.name,
    source: 'agent-harness',
    runtimeLabel: formatHarnessAdapter(agent.adapter),
    modelLabel: agent.modelId ?? 'default',
    detail: `${agent.adapter}:main`,
    canChat: true,
    canDelete: true,
  }
}

export function getAgentsLoading(input: {
  adaptersLoading: boolean
  harnessAgentsLoading: boolean
}): boolean {
  return input.adaptersLoading || input.harnessAgentsLoading
}

export function getInlineError(input: {
  pageError: string | null
  adaptersError: Error | null
  harnessAgentsError: Error | null
}): string | null {
  return (
    input.pageError ??
    input.adaptersError?.message ??
    input.harnessAgentsError?.message ??
    null
  )
}
