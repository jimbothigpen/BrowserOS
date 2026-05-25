import type { NavigateFunction } from 'react-router'
import {
  AGENT_CREATED_EVENT,
  AGENT_DELETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import type { HarnessAgent, HarnessAgentAdapter } from './agent-harness-types'
import type {
  AgentListItem,
  CreateAgentRuntime,
  ProviderOption,
} from './agents-page-types'

export interface AgentPageActionInput {
  createRuntime: CreateAgentRuntime
  createHermesProviderId: string
  harnessModelId: string
  harnessReasoningEffort: string
  navigate: NavigateFunction
  newName: string
  selectableHermesProviders: ProviderOption[]
  createHarnessAgent: (input: {
    name: string
    adapter: HarnessAgentAdapter
    modelId?: string
    reasoningEffort?: string
    providerType?: string
    apiKey?: string
    baseUrl?: string
  }) => Promise<HarnessAgent>
  deleteHarnessAgent: (agentId: string) => Promise<unknown>
  setCreateError: (error: string | null) => void
  setCreateOpen: (open: boolean) => void
  setDeletingAgentKey: (key: string | null) => void
  setNewName: (name: string) => void
  setPageError: (error: string | null) => void
}

export function createAgentPageActions(input: AgentPageActionInput) {
  const runWithPageErrorHandling = async (fn: () => Promise<unknown>) => {
    input.setPageError(null)
    try {
      await fn()
    } catch (err) {
      input.setPageError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleHarnessCreate = async () => {
    if (!input.newName.trim()) return

    const isHermes = input.createRuntime === 'hermes'
    // Hermes pulls every provider field from the user's selected entry
    // in the global LLM-providers list (managed under AI Settings). The
    // backend rejects creation if any required field is missing.
    const hermesProvider = isHermes
      ? input.selectableHermesProviders.find(
          (option) => option.id === input.createHermesProviderId,
        )
      : undefined
    const effectiveModelId = isHermes
      ? hermesProvider?.modelId
      : input.harnessModelId || undefined

    input.setCreateError(null)
    try {
      const agent = await input.createHarnessAgent({
        name: input.newName.trim(),
        adapter: input.createRuntime as HarnessAgentAdapter,
        modelId: effectiveModelId,
        reasoningEffort: input.harnessReasoningEffort || undefined,
        providerType: hermesProvider?.type,
        apiKey: hermesProvider?.apiKey,
        baseUrl: hermesProvider?.baseUrl,
      })
      input.setCreateOpen(false)
      input.setNewName('')
      track(AGENT_CREATED_EVENT, {
        runtime: input.createRuntime,
        model_id: effectiveModelId,
        reasoning_effort: input.harnessReasoningEffort || undefined,
        provider_type: hermesProvider?.type,
      })
      input.navigate(`/agents/${agent.id}`)
    } catch (err) {
      input.setCreateError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreate = () => {
    const createByRuntime: Record<CreateAgentRuntime, () => Promise<void>> = {
      claude: handleHarnessCreate,
      codex: handleHarnessCreate,
      hermes: handleHarnessCreate,
    }
    void createByRuntime[input.createRuntime]()
  }

  const handleDelete = async (agent: AgentListItem) => {
    input.setDeletingAgentKey(agent.key)
    await runWithPageErrorHandling(async () => {
      const deleteBySource: Record<
        AgentListItem['source'],
        (agentId: string) => Promise<unknown>
      > = {
        'agent-harness': (agentId) => input.deleteHarnessAgent(agentId),
      }
      await deleteBySource[agent.source](agent.agentId)
      track(AGENT_DELETED_EVENT, {
        runtime: agent.source,
        agent_id: agent.agentId,
      })
    })
    input.setDeletingAgentKey(null)
  }

  return {
    handleCreate,
    handleDelete,
    runWithPageErrorHandling,
  }
}
