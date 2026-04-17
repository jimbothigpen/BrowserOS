import type { FC } from 'react'
import { Outlet, useOutletContext } from 'react-router'
import { type AgentEntry, useAgents } from '@/entrypoints/app/agents/useAgents'
import {
  type OpenClawStatus,
  useOpenClawStatus,
} from '@/entrypoints/app/agents/useOpenClaw'

interface AgentCommandContextValue {
  agents: AgentEntry[]
  agentsLoading: boolean
  status: OpenClawStatus | null
  statusLoading: boolean
}

export const AgentCommandLayout: FC = () => {
  const { status, loading: statusLoading } = useOpenClawStatus(5000)
  const { agents, loading: agentsLoading } = useAgents()

  return (
    <Outlet
      context={
        {
          agents,
          agentsLoading,
          status,
          statusLoading,
        } satisfies AgentCommandContextValue
      }
    />
  )
}

export function useAgentCommandData(): AgentCommandContextValue {
  return useOutletContext<AgentCommandContextValue>()
}
