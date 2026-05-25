import type { FC } from 'react'
import { Outlet, useOutletContext } from 'react-router'
import type { AgentEntry } from '@/entrypoints/app/agents/agent-harness-types'
import { useHarnessAgents } from '@/entrypoints/app/agents/useAgents'

interface AgentCommandContextValue {
  agents: AgentEntry[]
  agentsLoading: boolean
}

export const AgentCommandLayout: FC = () => {
  const { agents: harnessAgents, loading: harnessAgentsLoading } =
    useHarnessAgents()

  return (
    <Outlet
      context={
        {
          agents: harnessAgents,
          agentsLoading: harnessAgentsLoading,
        } satisfies AgentCommandContextValue
      }
    />
  )
}

export function useAgentCommandData(): AgentCommandContextValue {
  return useOutletContext<AgentCommandContextValue>()
}
