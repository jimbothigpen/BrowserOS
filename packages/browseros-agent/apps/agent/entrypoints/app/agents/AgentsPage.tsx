import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'
import { AgentChat } from './AgentChat'
import { AgentTerminal } from './AgentTerminal'
import {
  getOpenClawOperatorState,
  type OpenClawOperatorState,
} from './openclaw-operator-state'
import { getOpenClawSupportedProviders } from './openclaw-supported-providers'
import {
  type AgentEntry,
  type OpenClawStatus,
  useOpenClawAgents,
  useOpenClawMutations,
  useOpenClawStatus,
  usePodmanOverrides,
} from './useOpenClaw'

const CONTROL_PLANE_COPY: Record<
  OpenClawStatus['controlPlaneStatus'],
  {
    badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive'
    badgeLabel: string
  }
> = {
  connected: {
    badgeVariant: 'default',
    badgeLabel: 'Control Plane Ready',
  },
  connecting: {
    badgeVariant: 'secondary',
    badgeLabel: 'Connecting',
  },
  reconnecting: {
    badgeVariant: 'secondary',
    badgeLabel: 'Reconnecting',
  },
  recovering: {
    badgeVariant: 'secondary',
    badgeLabel: 'Recovering',
  },
  disconnected: {
    badgeVariant: 'outline',
    badgeLabel: 'Disconnected',
  },
  failed: {
    badgeVariant: 'destructive',
    badgeLabel: 'Needs Attention',
  },
}

const FALLBACK_CONTROL_PLANE_COPY = {
  badgeVariant: 'outline' as const,
  badgeLabel: 'Unknown',
}

const RECOVERY_REASON_COPY: Record<
  NonNullable<OpenClawStatus['lastRecoveryReason']>,
  string
> = {
  transient_disconnect:
    'The control channel dropped briefly and BrowserOS is retrying it.',
  signature_expired:
    'The gateway rejected the signed device handshake because its clock drifted.',
  pairing_required:
    'The gateway asked BrowserOS to approve its local device identity again.',
  token_mismatch:
    'BrowserOS had to reload the gateway token before reconnecting.',
  container_not_ready:
    'The OpenClaw gateway process is not ready yet, so control-plane recovery cannot start.',
  unknown:
    'BrowserOS hit an unexpected gateway error and could not classify it cleanly.',
}

const StatusBadge: FC<{ status: OpenClawStatus['status'] }> = ({ status }) => {
  const variants: Record<
    OpenClawStatus['status'],
    {
      variant: 'default' | 'secondary' | 'outline' | 'destructive'
      label: string
    }
  > = {
    running: { variant: 'default', label: 'Running' },
    starting: { variant: 'secondary', label: 'Starting...' },
    stopped: { variant: 'outline', label: 'Stopped' },
    error: { variant: 'destructive', label: 'Error' },
    uninitialized: { variant: 'outline', label: 'Not Set Up' },
  }
  const current = variants[status] ?? {
    variant: 'outline' as const,
    label: 'Unknown',
  }
  return <Badge variant={current.variant}>{current.label}</Badge>
}

const ControlPlaneBadge: FC<{
  status: OpenClawStatus['controlPlaneStatus']
}> = ({ status }) => {
  const current = CONTROL_PLANE_COPY[status] ?? FALLBACK_CONTROL_PLANE_COPY
  return <Badge variant={current.badgeVariant}>{current.badgeLabel}</Badge>
}

function getRecoveryDetail(status: OpenClawStatus): string | null {
  if (!status.lastRecoveryReason && !status.lastGatewayError) return null

  const detail = status.lastRecoveryReason
    ? RECOVERY_REASON_COPY[status.lastRecoveryReason]
    : null

  if (status.lastGatewayError && detail) {
    return `${detail} Latest gateway error: ${status.lastGatewayError}`
  }

  return status.lastGatewayError ?? detail
}

function getOperatorCardCopy(
  status: OpenClawStatus | null,
  operatorState: OpenClawOperatorState,
) {
  switch (operatorState) {
    case 'loading':
      return {
        title: 'Loading OpenClaw',
        description: 'Checking runtime status...',
        tone: 'muted' as const,
      }
    case 'setup-needed':
      return {
        title: 'Set Up OpenClaw',
        description: status?.podmanAvailable
          ? 'Create the local runtime so agents can run in a container.'
          : 'Podman is required before OpenClaw can run agents.',
        tone: 'muted' as const,
      }
    case 'starting':
      return {
        title: 'OpenClaw is Starting',
        description:
          status?.controlPlaneStatus === 'recovering'
            ? 'BrowserOS is recovering the runtime and bringing the control plane back up.'
            : 'OpenClaw is still coming up. Wait for it to become ready before creating agents.',
        tone: 'muted' as const,
      }
    case 'healthy':
      return {
        title: 'OpenClaw Ready',
        description:
          'OpenClaw can create, manage, and chat with agents normally.',
        tone: 'healthy' as const,
      }
    case 'needs-attention':
      return {
        title:
          status?.status === 'stopped'
            ? 'Gateway Stopped'
            : status?.status === 'error'
              ? 'Gateway Error'
              : 'OpenClaw Needs Attention',
        description:
          status?.error ??
          status?.lastGatewayError ??
          'BrowserOS could not keep the OpenClaw runtime healthy.',
        tone: 'destructive' as const,
      }
  }
}

interface ProviderSelectorProps {
  providers: Array<{
    id: string
    type: string
    name: string
    modelId: string
    baseUrl?: string
  }>
  defaultProviderId: string
  selectedId: string
  onSelect: (id: string) => void
}

const ProviderSelector: FC<ProviderSelectorProps> = ({
  providers,
  defaultProviderId,
  selectedId,
  onSelect,
}) => {
  if (providers.length === 0) {
    return (
      <div className="space-y-2">
        <p className="font-medium text-sm">LLM Provider</p>
        <p className="text-muted-foreground text-sm">
          No compatible LLM providers configured.{' '}
          <a href="#/settings/ai" className="underline">
            Add one in AI settings
          </a>{' '}
          first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm" htmlFor="provider-select">
        LLM Provider
      </label>
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger id="provider-select">
          <SelectValue placeholder="Select a provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name} — {provider.modelId}
              {provider.id === defaultProviderId ? ' (default)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        Uses your existing API key from BrowserOS settings. The key is passed to
        the container and never leaves your machine.
      </p>
    </div>
  )
}

interface PodmanOverridesCardProps {
  variant: 'inline' | 'standalone'
}

const PodmanOverridesCard: FC<PodmanOverridesCardProps> = ({ variant }) => {
  const { overrides, loading, saving, error, saveOverrides, clearOverrides } =
    usePodmanOverrides()

  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const [collapsed, setCollapsed] = useState(variant === 'standalone')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!touched && overrides) setValue(overrides.podmanPath ?? '')
  }, [overrides, touched])

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    setLocalError(null)
    try {
      await saveOverrides(trimmed)
      setTouched(false)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleClear = async () => {
    setLocalError(null)
    try {
      await clearOverrides()
      setValue('')
      setTouched(false)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const hasOverride = !!overrides?.podmanPath
  const effective = overrides?.effectivePodmanPath ?? null
  const inlineErrorMessage = localError ?? error?.message ?? null

  const body = (
    <div className="space-y-3">
      <div className="space-y-1">
        <label
          htmlFor={`podman-path-${variant}`}
          className="font-medium text-sm"
        >
          Podman binary path
        </label>
        <Input
          id={`podman-path-${variant}`}
          value={value}
          onChange={(event) => {
            setTouched(true)
            setValue(event.target.value)
          }}
          placeholder="/opt/homebrew/bin/podman"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <p className="text-muted-foreground text-xs">
          Install Podman yourself (e.g. <code>brew install podman</code>) and
          paste the absolute path to the binary. Restart the gateway after
          saving.
        </p>
      </div>

      {effective && (
        <p className="text-muted-foreground text-xs">
          Currently using: <code className="break-all">{effective}</code>
        </p>
      )}

      {inlineErrorMessage && (
        <p className="text-destructive text-xs">{inlineErrorMessage}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || loading || !value.trim()}
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleClear}
          disabled={saving || loading || !hasOverride}
        >
          Clear
        </Button>
      </div>
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className="mt-3 rounded-md border bg-background p-3">
        <p className="mb-2 font-medium text-sm">Use your own Podman</p>
        {body}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer py-3"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <CardTitle className="flex items-center gap-2 text-base">
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
          Advanced: Podman binary path
        </CardTitle>
      </CardHeader>
      {!collapsed && <CardContent className="pt-0">{body}</CardContent>}
    </Card>
  )
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: page orchestration spans setup, runtime, agents, and dialogs.
export const AgentsPage: FC = () => {
  const {
    status,
    loading: statusLoading,
    error: statusError,
  } = useOpenClawStatus()
  const { providers, defaultProviderId } = useLlmProviders()
  const agentsQueryEnabled =
    status?.status === 'running' && status.controlPlaneStatus === 'connected'
  const {
    agents,
    loading: agentsLoading,
    error: agentsError,
  } = useOpenClawAgents(agentsQueryEnabled)
  const {
    setupOpenClaw,
    createAgent,
    deleteAgent,
    startOpenClaw,
    stopOpenClaw,
    restartOpenClaw,
    repairOpenClaw,
    resetOpenClaw,
    actionInProgress,
    settingUp,
    creating,
    deleting,
    repairing,
    resetting,
  } = useOpenClawMutations()

  const [setupOpen, setSetupOpen] = useState(false)
  const [setupProviderId, setSetupProviderId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [createProviderId, setCreateProviderId] = useState('')

  const [chatAgent, setChatAgent] = useState<AgentEntry | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const compatibleProviders = getOpenClawSupportedProviders(providers)

  useEffect(() => {
    if (compatibleProviders.length === 0) return
    const fallbackId =
      compatibleProviders.find((provider) => provider.id === defaultProviderId)
        ?.id ?? compatibleProviders[0].id

    if (setupOpen && !setupProviderId) setSetupProviderId(fallbackId)
    if (createOpen && !createProviderId) setCreateProviderId(fallbackId)
  }, [
    setupOpen,
    createOpen,
    setupProviderId,
    createProviderId,
    compatibleProviders,
    defaultProviderId,
  ])

  useEffect(() => {
    if (!createOpen) return
    setNewName((current) => current || 'agent')
  }, [createOpen])

  const operatorState = useMemo(() => {
    if (status) return getOpenClawOperatorState(status).kind
    return statusError || agentsError ? 'needs-attention' : 'loading'
  }, [status, statusError, agentsError])

  const canManageAgents = operatorState === 'healthy'
  const operatorCopy = getOperatorCardCopy(status, operatorState)
  const operatorIssue =
    error ?? statusError?.message ?? agentsError?.message ?? null
  const recoveryDetail = status ? getRecoveryDetail(status) : null

  const runWithErrorHandling = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSetup = async () => {
    const provider = compatibleProviders.find(
      (item) => item.id === setupProviderId,
    )

    await runWithErrorHandling(async () => {
      await setupOpenClaw({
        providerType: provider?.type,
        providerName: provider?.name,
        baseUrl: provider?.baseUrl,
        apiKey: provider?.apiKey,
        modelId: provider?.modelId,
      })
      setSetupOpen(false)
    })
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const provider = compatibleProviders.find(
      (item) => item.id === createProviderId,
    )
    const normalizedName = newName.trim().toLowerCase().replace(/\s+/g, '-')

    await runWithErrorHandling(async () => {
      await createAgent({
        name: normalizedName,
        providerType: provider?.type,
        providerName: provider?.name,
        baseUrl: provider?.baseUrl,
        apiKey: provider?.apiKey,
        modelId: provider?.modelId,
      })
      setCreateOpen(false)
      setNewName('')
    })
  }

  const handleDelete = async (id: string) => {
    await runWithErrorHandling(async () => {
      await deleteAgent(id)
    })
  }

  const handleStop = async () => {
    await runWithErrorHandling(async () => {
      await stopOpenClaw()
    })
  }

  const handleStart = async () => {
    await runWithErrorHandling(async () => {
      await startOpenClaw()
    })
  }

  const handleRestart = async () => {
    await runWithErrorHandling(async () => {
      await restartOpenClaw()
    })
  }

  const handleRepair = async () => {
    await runWithErrorHandling(async () => {
      await repairOpenClaw()
    })
  }

  const handleReset = async () => {
    setResetConfirmOpen(false)
    await runWithErrorHandling(async () => {
      await resetOpenClaw()
    })
  }

  if (showTerminal) {
    return <AgentTerminal onBack={() => setShowTerminal(false)} />
  }

  if (chatAgent) {
    return (
      <AgentChat
        agentId={chatAgent.agentId}
        agentName={chatAgent.name}
        onBack={() => setChatAgent(null)}
      />
    )
  }

  if (statusLoading && !status) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl">Agents</h1>
          <p className="text-muted-foreground text-sm">
            OpenClaw agents running in a local container
          </p>
        </div>

        {status && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge status={status.status} />
            {status.status !== 'uninitialized' && (
              <ControlPlaneBadge status={status.controlPlaneStatus} />
            )}
            {operatorState === 'healthy' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRestart}
                  disabled={actionInProgress}
                  title="Restart gateway"
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStop}
                  disabled={actionInProgress}
                  title="Stop gateway"
                >
                  <Square className="size-4" />
                </Button>
                <Button variant="outline" onClick={() => setShowTerminal(true)}>
                  <TerminalSquare className="mr-1 size-4" />
                  Terminal
                </Button>
                <Button
                  onClick={() => setCreateOpen(true)}
                  disabled={!canManageAgents}
                >
                  <Plus className="mr-1 size-4" />
                  New Agent
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <Card
        className={
          operatorCopy.tone === 'destructive' ? 'border-destructive' : ''
        }
      >
        <CardContent className="space-y-4 py-8">
          <div className="flex items-start gap-4">
            <div
              className={`flex size-12 items-center justify-center rounded-full border ${
                operatorCopy.tone === 'destructive'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border bg-muted text-muted-foreground'
              }`}
            >
              {operatorState === 'loading' || operatorState === 'starting' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : operatorState === 'needs-attention' ? (
                <AlertCircle className="size-5" />
              ) : (
                <Cpu className="size-5" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-lg">{operatorCopy.title}</h3>
                {status && status.status !== 'uninitialized' && (
                  <ControlPlaneBadge status={status.controlPlaneStatus} />
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {operatorCopy.description}
              </p>
              {recoveryDetail && operatorState === 'needs-attention' && (
                <p className="text-muted-foreground text-sm">
                  {recoveryDetail}
                </p>
              )}
              {operatorIssue && (
                <p className="text-destructive text-sm">{operatorIssue}</p>
              )}
              {status?.port !== null && status?.port !== undefined && (
                <p className="text-muted-foreground text-xs">
                  Runtime port: <code>{status.port}</code>
                </p>
              )}
              {status?.status === 'running' && (
                <p className="text-muted-foreground text-xs">
                  Agent count: {status.agentCount}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {operatorState === 'setup-needed' && status?.podmanAvailable && (
              <Button onClick={() => setSetupOpen(true)}>Set Up Now</Button>
            )}
            {operatorState === 'starting' && (
              <Button
                variant="outline"
                onClick={handleRestart}
                disabled={actionInProgress}
              >
                Restart Gateway
              </Button>
            )}
            {operatorState === 'needs-attention' && (
              <>
                {status?.status === 'stopped' || status?.status === 'error' ? (
                  <Button onClick={handleStart} disabled={actionInProgress}>
                    Start Gateway
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={handleRepair}
                  disabled={actionInProgress || repairing}
                >
                  {repairing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  Repair Runtime
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setResetConfirmOpen(true)}
                  disabled={actionInProgress || resetting}
                >
                  Reset Runtime
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRestart}
                  disabled={actionInProgress}
                >
                  Restart Gateway
                </Button>
              </>
            )}
          </div>

          {(operatorState === 'setup-needed' ||
            operatorState === 'needs-attention') && (
            <div className="w-full max-w-md">
              <PodmanOverridesCard variant="inline" />
            </div>
          )}
        </CardContent>
      </Card>

      {status?.status === 'running' && operatorState === 'healthy' && (
        <div className="space-y-3">
          {agentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8">
                <p className="text-muted-foreground text-sm">
                  No agents yet. Create one to get started.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                  disabled={!canManageAgents}
                >
                  <Plus className="mr-1 size-4" />
                  Create Agent
                </Button>
              </CardContent>
            </Card>
          ) : (
            agents.map((agent) => (
              <Card key={agent.agentId}>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Cpu className="size-5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">
                          {agent.name}
                        </CardTitle>
                      </div>
                      <p className="font-mono text-muted-foreground text-xs">
                        {agent.workspace}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setChatAgent(agent)}
                      disabled={!canManageAgents}
                    >
                      <MessageSquare className="mr-1 size-4" />
                      Chat
                    </Button>
                    {agent.agentId !== 'main' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(agent.agentId)}
                        disabled={!canManageAgents || deleting}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>
      )}

      <PodmanOverridesCard variant="standalone" />

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Up OpenClaw</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <ProviderSelector
              providers={compatibleProviders}
              defaultProviderId={defaultProviderId}
              selectedId={setupProviderId}
              onSelect={setSetupProviderId}
            />
            <Button
              onClick={handleSetup}
              disabled={settingUp || compatibleProviders.length === 0}
              className="w-full"
            >
              {settingUp ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                'Set Up & Start'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label
                htmlFor="agent-name"
                className="mb-1 block font-medium text-sm"
              >
                Agent Name
              </label>
              <Input
                id="agent-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="research-agent"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate()
                }}
              />
              <p className="mt-1 text-muted-foreground text-xs">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <ProviderSelector
              providers={compatibleProviders}
              defaultProviderId={defaultProviderId}
              selectedId={createProviderId}
              onSelect={setCreateProviderId}
            />

            <Button
              onClick={handleCreate}
              disabled={
                !newName.trim() ||
                creating ||
                !canManageAgents ||
                compatibleProviders.length === 0
              }
              className="w-full"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Agent'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset OpenClaw runtime?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-muted-foreground text-sm">
              This stops the gateway and Podman machine, clears the stored
              runtime port, and removes recovery state. Use repair first if you
              just need a non-destructive restart.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setResetConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleReset()}
                disabled={actionInProgress || resetting}
              >
                {resetting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Reset Runtime
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
