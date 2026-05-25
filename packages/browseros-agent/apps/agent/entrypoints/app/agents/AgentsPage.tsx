import { Loader2 } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'
import { AgentList } from './AgentList'
import { AgentsHeader } from './AgentsHeader'
import type { HarnessAgent, HarnessAgentAdapter } from './agent-harness-types'
import { createAgentPageActions } from './agents-page-actions'
import {
  useDefaultAgentName,
  useHarnessAgentDefaults,
  useHermesProviderSelection,
} from './agents-page-hooks'
import {
  type CreateAgentRuntime,
  DEFAULT_CREATE_RUNTIME,
  DEFAULT_HARNESS_ADAPTER,
} from './agents-page-types'
import {
  getAgentsLoading,
  getInlineError,
  toHarnessListItem,
} from './agents-page-utils'
import { NewAgentDialog } from './NewAgentDialog'
import { InlineErrorAlert } from './PageAlerts'
import {
  useAgentAdapters,
  useCreateHarnessAgent,
  useDeleteHarnessAgent,
  useHarnessAgents,
  useUpdateHarnessAgent,
} from './useAgents'

export const AgentsPage: FC = () => {
  const navigate = useNavigate()
  const { providers, defaultProviderId } = useLlmProviders()
  const {
    adapters,
    loading: adaptersLoading,
    error: adaptersError,
  } = useAgentAdapters()
  const {
    harnessAgents,
    loading: harnessAgentsLoading,
    error: harnessAgentsError,
  } = useHarnessAgents()
  const createHarnessAgent = useCreateHarnessAgent()
  const deleteHarnessAgent = useDeleteHarnessAgent()
  const updateHarnessAgent = useUpdateHarnessAgent()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [createRuntime, setCreateRuntime] = useState<CreateAgentRuntime>(
    DEFAULT_CREATE_RUNTIME,
  )
  const [harnessAdapterId, setHarnessAdapterId] = useState<HarnessAgentAdapter>(
    DEFAULT_HARNESS_ADAPTER,
  )
  const [harnessModelId, setHarnessModelId] = useState('')
  const [harnessReasoningEffort, setHarnessReasoningEffort] = useState('')
  const [createHermesProviderId, setCreateHermesProviderId] = useState('')
  const [pageError, setPageError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingAgentKey, setDeletingAgentKey] = useState<string | null>(null)

  const { selectableHermesProviders } = useHermesProviderSelection({
    providers,
    defaultProviderId,
    createOpen,
    createRuntime,
    createHermesProviderId,
    setCreateHermesProviderId,
  })
  useDefaultAgentName(createOpen, setNewName)
  useHarnessAgentDefaults({
    adapters,
    createOpen,
    harnessAdapterId,
    setHarnessAdapterId,
    setHarnessModelId,
    setHarnessReasoningEffort,
  })

  const agentListItems = useMemo(
    () => harnessAgents.map(toHarnessListItem),
    [harnessAgents],
  )
  const harnessAgentLookup = useMemo(() => {
    const map = new Map<string, HarnessAgent>()
    for (const agent of harnessAgents) map.set(agent.id, agent)
    return map
  }, [harnessAgents])
  const agentActivity = useMemo(() => {
    const map: Record<
      string,
      {
        status: 'working' | 'idle' | 'asleep' | 'error'
        lastUsedAt: number | null
      }
    > = {}
    for (const agent of harnessAgents) {
      if (!agent.status) continue
      map[agent.id] = {
        status: agent.status,
        lastUsedAt: agent.lastUsedAt ?? null,
      }
    }
    return map
  }, [harnessAgents])
  const inlineError = getInlineError({
    pageError,
    adaptersError,
    harnessAgentsError,
  })
  const agentsLoading = getAgentsLoading({
    adaptersLoading,
    harnessAgentsLoading,
  })
  const creatingAgent = createHarnessAgent.isPending
  const deletingAgent = deleteHarnessAgent.isPending

  const handleHarnessAdapterChange = (adapter: HarnessAgentAdapter) => {
    const descriptor = adapters.find((entry) => entry.id === adapter)
    setHarnessAdapterId(adapter)
    setHarnessModelId(descriptor?.defaultModelId ?? '')
    setHarnessReasoningEffort(descriptor?.defaultReasoningEffort ?? '')
  }

  const { handleCreate, handleDelete } = createAgentPageActions({
    createRuntime,
    createHermesProviderId,
    harnessModelId,
    harnessReasoningEffort,
    navigate,
    newName,
    selectableHermesProviders,
    createHarnessAgent: createHarnessAgent.mutateAsync,
    deleteHarnessAgent: deleteHarnessAgent.mutateAsync,
    setCreateError,
    setCreateOpen,
    setDeletingAgentKey,
    setNewName,
    setPageError,
  })

  if (harnessAgentsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-background px-6 py-8">
      <div className="fade-in slide-in-from-bottom-5 mx-auto flex w-full max-w-5xl animate-in flex-col gap-6 duration-500">
        <AgentsHeader onCreateAgent={() => setCreateOpen(true)} />

        {inlineError ? (
          <InlineErrorAlert
            message={inlineError}
            onDismiss={() => setPageError(null)}
          />
        ) : null}

        <AgentList
          agents={agentListItems}
          activity={agentActivity}
          harnessAgentLookup={harnessAgentLookup}
          adapters={adapters}
          loading={agentsLoading}
          deletingAgentKey={deletingAgent ? deletingAgentKey : null}
          onCreateAgent={() => setCreateOpen(true)}
          onDeleteAgent={(agent) => {
            void handleDelete(agent)
          }}
          onPinToggle={(agent, next) => {
            if (!harnessAgentLookup.has(agent.agentId)) return
            updateHarnessAgent.mutate({
              agentId: agent.agentId,
              patch: { pinned: next },
            })
          }}
        />

        <NewAgentDialog
          adapters={adapters}
          createError={createError}
          createRuntime={createRuntime}
          creating={creatingAgent}
          defaultProviderId={defaultProviderId}
          harnessAdapterId={harnessAdapterId}
          harnessModelId={harnessModelId}
          harnessReasoningEffort={harnessReasoningEffort}
          hermesProviders={selectableHermesProviders}
          hermesSelectedProviderId={createHermesProviderId}
          name={newName}
          open={createOpen}
          onCreate={handleCreate}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) {
              setCreateError(null)
              createHarnessAgent.reset()
              setCreateHermesProviderId('')
            }
          }}
          onRuntimeChange={setCreateRuntime}
          onHarnessAdapterChange={handleHarnessAdapterChange}
          onHarnessModelChange={setHarnessModelId}
          onHarnessReasoningChange={setHarnessReasoningEffort}
          onHermesProviderChange={setCreateHermesProviderId}
          onNameChange={setNewName}
        />
      </div>
    </div>
  )
}
