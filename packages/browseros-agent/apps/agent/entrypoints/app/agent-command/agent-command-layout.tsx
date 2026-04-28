import type { FC } from 'react'
import { Outlet, useOutletContext } from 'react-router'
import { useHarnessAgents } from '@/entrypoints/app/agents/useAgents'
import type {
  AgentEntry,
  OpenClawStatus,
} from '@/entrypoints/app/agents/useOpenClaw'

interface AgentCommandContextValue {
  agents: AgentEntry[]
  agentsLoading: boolean
  status: OpenClawStatus | null
  statusLoading: boolean
}

export const AgentCommandLayout: FC = () => {
  const { agents, loading: agentsLoading } = useHarnessAgents()

  return (
    <Outlet
      context={
        {
          agents,
          agentsLoading,
          status: null,
          statusLoading: false,
        } satisfies AgentCommandContextValue
      }
    />
  )
}

export function useAgentCommandData(): AgentCommandContextValue {
  return useOutletContext<AgentCommandContextValue>()
}
