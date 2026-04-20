import type {
  BrowserOSAgentRoleId,
  BrowserOSCustomRoleInput,
} from '@browseros/shared/types/role-aware-agents'
import type {
  BrowserOSAgentProgram,
  BrowserOSProgramRun,
  CreateAgentProgramInput,
  UpdateAgentProgramInput,
} from '@browseros/shared/types/role-programs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'

export interface AgentEntry {
  agentId: string
  name: string
  workspace: string
  model?: unknown
  role?: {
    roleSource: 'builtin' | 'custom'
    roleId?: BrowserOSAgentRoleId
    roleName: string
    shortDescription: string
  }
}

export interface RoleTemplateSummary {
  id: BrowserOSAgentRoleId
  name: string
  shortDescription: string
  longDescription: string
  recommendedApps: string[]
  defaultAgentName: string
  boundaries: Array<{
    key: string
    label: string
    description: string
    defaultMode: 'allow' | 'ask' | 'block'
  }>
}

export interface OpenClawStatus {
  status: 'uninitialized' | 'starting' | 'running' | 'stopped' | 'error'
  podmanAvailable: boolean
  machineReady: boolean
  port: number | null
  agentCount: number
  error: string | null
  scheduler?: {
    running: boolean
    activeProgramCount: number
  }
  controlPlaneStatus:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'recovering'
    | 'failed'
  lastGatewayError: string | null
  lastRecoveryReason:
    | 'transient_disconnect'
    | 'signature_expired'
    | 'pairing_required'
    | 'token_mismatch'
    | 'container_not_ready'
    | 'unknown'
    | null
}

export interface OpenClawAgentMutationInput {
  name: string
  roleId?: BrowserOSAgentRoleId
  customRole?: BrowserOSCustomRoleInput
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface OpenClawSetupInput {
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface AgentProgramEntry extends BrowserOSAgentProgram {}
export interface AgentProgramRunEntry extends BrowserOSProgramRun {}

export function getModelDisplayName(model: unknown): string | undefined {
  if (typeof model === 'string') return model.split('/').pop()
  return undefined
}

export const OPENCLAW_QUERY_KEYS = {
  status: 'openclaw-status',
  agents: 'openclaw-agents',
  roles: 'openclaw-roles',
  programs: 'openclaw-programs',
  programRuns: 'openclaw-program-runs',
  podmanOverrides: 'openclaw-podman-overrides',
} as const

export interface PodmanOverrides {
  podmanPath: string | null
  effectivePodmanPath: string
}

async function clawFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl}/claw${path}`, init)
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) {
        message = body.error
      }
    } catch {}
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

async function fetchOpenClawStatus(baseUrl: string): Promise<OpenClawStatus> {
  return clawFetch<OpenClawStatus>(baseUrl, '/status')
}

async function fetchOpenClawAgents(baseUrl: string): Promise<AgentEntry[]> {
  const data = await clawFetch<{ agents: AgentEntry[] }>(baseUrl, '/agents')
  return data.agents ?? []
}

async function fetchOpenClawRoles(
  baseUrl: string,
): Promise<RoleTemplateSummary[]> {
  const data = await clawFetch<{ roles: RoleTemplateSummary[] }>(
    baseUrl,
    '/roles',
  )
  return data.roles ?? []
}

async function fetchOpenClawPrograms(
  baseUrl: string,
  agentId: string,
): Promise<AgentProgramEntry[]> {
  const data = await clawFetch<{ programs: AgentProgramEntry[] }>(
    baseUrl,
    `/agents/${agentId}/programs`,
  )
  return data.programs ?? []
}

async function fetchOpenClawProgramRuns(
  baseUrl: string,
  agentId: string,
): Promise<AgentProgramRunEntry[]> {
  const data = await clawFetch<{ runs: AgentProgramRunEntry[] }>(
    baseUrl,
    `/agents/${agentId}/program-runs`,
  )
  return data.runs ?? []
}

async function invalidateOpenClawQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [OPENCLAW_QUERY_KEYS.status] }),
    queryClient.invalidateQueries({ queryKey: [OPENCLAW_QUERY_KEYS.agents] }),
  ])
}

async function invalidateAgentProgramQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  baseUrl: string,
  agentId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [OPENCLAW_QUERY_KEYS.programs, baseUrl, agentId],
    }),
    queryClient.invalidateQueries({
      queryKey: [OPENCLAW_QUERY_KEYS.programRuns, baseUrl, agentId],
    }),
    queryClient.invalidateQueries({
      queryKey: [OPENCLAW_QUERY_KEYS.agents, baseUrl],
    }),
    queryClient.invalidateQueries({
      queryKey: [OPENCLAW_QUERY_KEYS.status, baseUrl],
    }),
  ])
}

export function useOpenClawStatus(pollMs = 5000) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<OpenClawStatus, Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.status, baseUrl],
    queryFn: () => fetchOpenClawStatus(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
    refetchInterval: pollMs,
  })

  return {
    status: query.data ?? null,
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawAgents(enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentEntry[], Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.agents, baseUrl],
    queryFn: () => fetchOpenClawAgents(baseUrl as string),
    enabled: !!baseUrl && !urlLoading && enabled,
  })

  return {
    agents: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawRoles() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<RoleTemplateSummary[], Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.roles, baseUrl],
    queryFn: () => fetchOpenClawRoles(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
    staleTime: 60_000,
  })

  return {
    roles: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawPrograms(agentId: string | null, enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentProgramEntry[], Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.programs, baseUrl, agentId],
    queryFn: () => fetchOpenClawPrograms(baseUrl as string, agentId as string),
    enabled: !!baseUrl && !urlLoading && !!agentId && enabled,
  })

  return {
    programs: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawProgramRuns(agentId: string | null, enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentProgramRunEntry[], Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.programRuns, baseUrl, agentId],
    queryFn: () =>
      fetchOpenClawProgramRuns(baseUrl as string, agentId as string),
    enabled: !!baseUrl && !urlLoading && !!agentId && enabled,
  })

  return {
    runs: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawMutations() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const ensureBaseUrl = () => {
    if (!baseUrl || urlLoading) {
      throw new Error('BrowserOS agent server URL is not ready')
    }
    return baseUrl
  }

  const onSuccess = () => invalidateOpenClawQueries(queryClient)
  const invalidateProgramsFor = (agentId: string) =>
    invalidateAgentProgramQueries(queryClient, ensureBaseUrl(), agentId)

  const setupMutation = useMutation({
    mutationFn: async (input: OpenClawSetupInput) =>
      clawFetch<{ status: string; agents: AgentEntry[] }>(
        ensureBaseUrl(),
        '/setup',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSuccess,
  })

  const createMutation = useMutation({
    mutationFn: async (input: OpenClawAgentMutationInput) =>
      clawFetch<{ agent: AgentEntry }>(ensureBaseUrl(), '/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      clawFetch<{ success: boolean }>(ensureBaseUrl(), `/agents/${id}`, {
        method: 'DELETE',
      }),
    onSuccess,
  })

  const startMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/start', {
        method: 'POST',
      }),
    onSuccess,
  })

  const stopMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/stop', {
        method: 'POST',
      }),
    onSuccess,
  })

  const restartMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/restart', {
        method: 'POST',
      }),
    onSuccess,
  })

  const reconnectMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/reconnect', {
        method: 'POST',
      }),
    onSuccess,
  })

  const createProgramMutation = useMutation({
    mutationFn: async ({
      agentId,
      input,
    }: {
      agentId: string
      input: CreateAgentProgramInput
    }) =>
      clawFetch<{ program: AgentProgramEntry }>(
        ensureBaseUrl(),
        `/agents/${agentId}/programs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSuccess: async (_data, variables) =>
      invalidateProgramsFor(variables.agentId),
  })

  const updateProgramMutation = useMutation({
    mutationFn: async ({
      agentId,
      programId,
      input,
    }: {
      agentId: string
      programId: string
      input: UpdateAgentProgramInput
    }) =>
      clawFetch<{ program: AgentProgramEntry }>(
        ensureBaseUrl(),
        `/agents/${agentId}/programs/${programId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSuccess: async (_data, variables) =>
      invalidateProgramsFor(variables.agentId),
  })

  const deleteProgramMutation = useMutation({
    mutationFn: async ({
      agentId,
      programId,
    }: {
      agentId: string
      programId: string
    }) =>
      clawFetch<{ success: boolean }>(
        ensureBaseUrl(),
        `/agents/${agentId}/programs/${programId}`,
        {
          method: 'DELETE',
        },
      ),
    onSuccess: async (_data, variables) =>
      invalidateProgramsFor(variables.agentId),
  })

  const runProgramMutation = useMutation({
    mutationFn: async ({
      agentId,
      programId,
    }: {
      agentId: string
      programId: string
    }) =>
      clawFetch<{ run: AgentProgramRunEntry }>(
        ensureBaseUrl(),
        `/agents/${agentId}/programs/${programId}/run`,
        {
          method: 'POST',
        },
      ),
    onSuccess: async (_data, variables) =>
      invalidateProgramsFor(variables.agentId),
  })

  return {
    setupOpenClaw: setupMutation.mutateAsync,
    createAgent: createMutation.mutateAsync,
    deleteAgent: deleteMutation.mutateAsync,
    startOpenClaw: startMutation.mutateAsync,
    stopOpenClaw: stopMutation.mutateAsync,
    restartOpenClaw: restartMutation.mutateAsync,
    reconnectOpenClaw: reconnectMutation.mutateAsync,
    createProgram: createProgramMutation.mutateAsync,
    updateProgram: updateProgramMutation.mutateAsync,
    deleteProgram: deleteProgramMutation.mutateAsync,
    runProgram: runProgramMutation.mutateAsync,
    actionInProgress:
      setupMutation.isPending ||
      createMutation.isPending ||
      deleteMutation.isPending ||
      startMutation.isPending ||
      stopMutation.isPending ||
      restartMutation.isPending ||
      reconnectMutation.isPending ||
      createProgramMutation.isPending ||
      updateProgramMutation.isPending ||
      deleteProgramMutation.isPending ||
      runProgramMutation.isPending,
    settingUp: setupMutation.isPending,
    creating: createMutation.isPending,
    deleting: deleteMutation.isPending,
    reconnecting: reconnectMutation.isPending,
    creatingProgram: createProgramMutation.isPending,
    updatingProgram: updateProgramMutation.isPending,
    deletingProgram: deleteProgramMutation.isPending,
    runningProgram: runProgramMutation.isPending,
  }
}

export function usePodmanOverrides() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const query = useQuery<PodmanOverrides, Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.podmanOverrides, baseUrl],
    queryFn: () =>
      clawFetch<PodmanOverrides>(baseUrl as string, '/podman-overrides'),
    enabled: !!baseUrl && !urlLoading,
  })

  const saveMutation = useMutation({
    mutationFn: async (podmanPath: string | null) =>
      clawFetch<PodmanOverrides>(baseUrl as string, '/podman-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podmanPath }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [OPENCLAW_QUERY_KEYS.podmanOverrides],
        }),
        queryClient.invalidateQueries({
          queryKey: [OPENCLAW_QUERY_KEYS.status],
        }),
      ])
    },
  })

  return {
    overrides: query.data ?? null,
    loading: query.isLoading || urlLoading,
    error: (query.error ?? urlError) as Error | null,
    saving: saveMutation.isPending,
    saveOverrides: (podmanPath: string) => saveMutation.mutateAsync(podmanPath),
    clearOverrides: () => saveMutation.mutateAsync(null),
  }
}

export interface OpenClawStreamEvent {
  type:
    | 'text-delta'
    | 'thinking'
    | 'tool-start'
    | 'tool-end'
    | 'tool-output'
    | 'lifecycle'
    | 'done'
    | 'error'
  data: Record<string, unknown>
}

export interface OpenClawChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatHistoryTurnLike {
  userText: string
  parts: Array<{ kind: string; text?: string }>
}

export function buildChatHistoryFromTurns(
  turns: ChatHistoryTurnLike[],
): OpenClawChatHistoryMessage[] {
  const messages: OpenClawChatHistoryMessage[] = []

  for (const turn of turns) {
    const userText = turn.userText.trim()
    if (userText) {
      messages.push({ role: 'user', content: userText })
    }

    const assistantText = turn.parts
      .filter(
        (
          part,
        ): part is {
          kind: 'text'
          text: string
        } => part.kind === 'text' && typeof part.text === 'string',
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n\n')

    if (assistantText) {
      messages.push({ role: 'assistant', content: assistantText })
    }
  }

  return messages
}

export async function chatWithAgent(
  agentId: string,
  message: string,
  sessionKey?: string,
  history: OpenClawChatHistoryMessage[] = [],
  signal?: AbortSignal,
): Promise<Response> {
  const baseUrl = await getAgentServerUrl()
  return fetch(`${baseUrl}/claw/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionKey, history }),
    signal,
  })
}
