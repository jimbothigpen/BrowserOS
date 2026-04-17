import type {
  BrowserOsAgentAdapterType,
  BrowserOsStoredAgent,
} from '@browseros/shared/types/browseros-agents'
import type {
  BrowserOSAgentRoleId,
  BrowserOSCustomRoleInput,
} from '@browseros/shared/types/role-aware-agents'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAgentServerUrl } from '../../../lib/browseros/helpers'
import { useAgentServerUrl } from '../../../lib/browseros/useBrowserOSProviders'

export interface AgentEntry {
  agentId: string
  name: string
  workspace: string
  model?: unknown
  adapterType: BrowserOsAgentAdapterType
  role?: {
    roleSource: 'builtin' | 'custom'
    roleId?: BrowserOSAgentRoleId
    roleName: string
    shortDescription: string
  }
}

export interface AgentCatalogEntry {
  adapterType: BrowserOsAgentAdapterType
  label: string
}

export interface AgentMutationInput {
  id: string
  name: string
  adapterType: BrowserOsAgentAdapterType
  binaryPath?: string
  roleId?: BrowserOSAgentRoleId
  customRole?: BrowserOSCustomRoleInput
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface AgentConversationMessage {
  role: 'user' | 'assistant'
  text: string
}

const AGENT_QUERY_KEYS = {
  agents: 'browseros-agents',
  catalog: 'browseros-agent-catalog',
} as const

async function agentFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}/agents${path}`, init)
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) {
        message = body.error
      }
    } catch {}
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

async function fetchAgents(baseUrl: string): Promise<AgentEntry[]> {
  const data = await agentFetch<{ agents: BrowserOsStoredAgent[] }>(baseUrl, '')
  return (data.agents ?? []).map(toAgentEntry)
}

async function fetchAgentCatalog(
  baseUrl: string,
): Promise<AgentCatalogEntry[]> {
  const data = await agentFetch<{ adapters: AgentCatalogEntry[] }>(
    baseUrl,
    '/catalog',
  )
  return data.adapters ?? []
}

async function invalidateAgentQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [AGENT_QUERY_KEYS.agents] }),
    queryClient.invalidateQueries({ queryKey: [AGENT_QUERY_KEYS.catalog] }),
  ])
}

export function useAgents() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentEntry[], Error>({
    queryKey: [AGENT_QUERY_KEYS.agents, baseUrl],
    queryFn: () => fetchAgents(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
  })

  return {
    agents: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useAgentCatalog() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentCatalogEntry[], Error>({
    queryKey: [AGENT_QUERY_KEYS.catalog, baseUrl],
    queryFn: () => fetchAgentCatalog(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
    staleTime: 60_000,
  })

  return {
    adapters: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useAgentMutations() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const ensureBaseUrl = () => {
    if (!baseUrl || urlLoading) {
      throw new Error('BrowserOS agent server URL is not ready')
    }
    return baseUrl
  }

  const onSuccess = () => invalidateAgentQueries(queryClient)

  const createMutation = useMutation({
    mutationFn: async (input: AgentMutationInput) =>
      agentFetch<{ agent: BrowserOsStoredAgent }>(ensureBaseUrl(), '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then((data) => ({
        agent: toAgentEntry(data.agent),
      })),
    onSuccess,
  })

  const deleteMutation = useMutation({
    mutationFn: async (agentId: string) =>
      agentFetch<{ success: boolean }>(ensureBaseUrl(), `/${agentId}`, {
        method: 'DELETE',
      }),
    onSuccess,
  })

  return {
    createAgent: createMutation.mutateAsync,
    deleteAgent: deleteMutation.mutateAsync,
    actionInProgress: createMutation.isPending || deleteMutation.isPending,
    creating: createMutation.isPending,
    deleting: deleteMutation.isPending,
  }
}

export async function chatWithAgent(
  agentId: string,
  input: {
    message: string
    sessionKey?: string
    conversation?: AgentConversationMessage[]
    signal?: AbortSignal
  },
): Promise<Response> {
  const baseUrl = await getAgentServerUrl()
  return fetch(`${baseUrl}/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input.message,
      sessionKey: input.sessionKey,
      conversation: input.conversation,
    }),
    signal: input.signal,
  })
}

function toAgentEntry(record: BrowserOsStoredAgent): AgentEntry {
  return {
    agentId: record.id,
    name: record.name,
    workspace:
      typeof record.runtimeBinding?.workspace === 'string'
        ? record.runtimeBinding.workspace
        : record.paths.cwd,
    model:
      record.runtimeBinding?.model ?? record.adapterConfig.modelId ?? undefined,
    adapterType: record.adapterType,
    role: record.role
      ? {
          roleSource: record.role.roleSource,
          roleId: record.role.roleId,
          roleName: record.role.roleName,
          shortDescription: record.role.shortDescription,
        }
      : undefined,
  }
}
