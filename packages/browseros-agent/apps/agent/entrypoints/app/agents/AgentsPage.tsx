import {
  AlertCircle,
  Cpu,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  ScrollText,
  Square,
  Trash2,
} from 'lucide-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'
import { useRpcClient } from '@/lib/rpc/RpcClientProvider'
import { AgentChat } from './AgentChat'
import { AgentLogsDialog } from './AgentLogsDialog'

// Types that use OAuth and have no raw API key to forward
const OAUTH_ONLY_TYPES = new Set(['chatgpt-pro', 'github-copilot', 'qwen-code'])

interface AgentInstance {
  id: string
  name: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  port: number
  createdAt: string
  error?: string
  providerType?: string
}

export const AgentsPage: FC = () => {
  const client = useRpcClient()
  const { providers, defaultProviderId } = useLlmProviders()
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [creating, setCreating] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [logsAgentId, setLogsAgentId] = useState<string | null>(null)
  const [chatAgentId, setChatAgentId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const triggerRefresh = () => setRefreshKey((k) => k + 1)

  const logsAgent = logsAgentId
    ? agents.find((a) => a.id === logsAgentId)
    : null
  const chatAgent = chatAgentId
    ? agents.find((a) => a.id === chatAgentId)
    : null

  // Filter providers that have an API key and can be forwarded to OpenClaw
  const compatibleProviders = useMemo(
    () => providers.filter((p) => p.apiKey && !OAUTH_ONLY_TYPES.has(p.type)),
    [providers],
  )

  // Pre-select default provider when dialog opens
  useEffect(() => {
    if (createDialogOpen && compatibleProviders.length > 0) {
      const defaultMatch = compatibleProviders.find(
        (p) => p.id === defaultProviderId,
      )
      setSelectedProviderId(defaultMatch?.id ?? compatibleProviders[0].id)
    }
  }, [createDialogOpen, compatibleProviders, defaultProviderId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey triggers refetch from outside the effect
  useEffect(() => {
    let cancelled = false

    const fetchAgents = async () => {
      try {
        const res = await client.agents.$get()
        const data = (await res.json()) as { agents: AgentInstance[] }
        if (!cancelled) setAgents(data.agents)
      } catch {
        // Server may not have the route yet
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const checkDocker = async () => {
      try {
        const res = await client.agents['docker-status'].$get()
        const data = (await res.json()) as { available: boolean }
        if (!cancelled) setDockerAvailable(data.available)
      } catch {
        if (!cancelled) setDockerAvailable(false)
      }
    }

    fetchAgents()
    checkDocker()
    const interval = setInterval(fetchAgents, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [client, refreshKey])

  const handleCreate = async () => {
    if (!newAgentName.trim()) return
    setCreating(true)
    try {
      const selectedProvider = compatibleProviders.find(
        (p) => p.id === selectedProviderId,
      )

      const baseUrl = await getAgentServerUrl()
      const res = await fetch(`${baseUrl}/agents/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgentName.trim(),
          providerType: selectedProvider?.type,
          apiKey: selectedProvider?.apiKey,
          baseUrl: selectedProvider?.baseUrl,
        }),
      })

      if (res.ok) {
        const data = (await res.json()) as { agent: AgentInstance }
        setCreateDialogOpen(false)
        setNewAgentName('')
        triggerRefresh()
        setLogsAgentId(data.agent.id)
      }
    } finally {
      setCreating(false)
    }
  }

  const agentAction = async (
    id: string,
    action: 'stop' | 'start' | 'delete',
  ) => {
    setActionInProgress(id)
    try {
      const baseUrl = await getAgentServerUrl()
      const method = action === 'delete' ? 'DELETE' : 'POST'
      const actionPath =
        action === 'delete'
          ? `${baseUrl}/agents/${id}`
          : `${baseUrl}/agents/${id}/${action}`
      await fetch(actionPath, { method })
      triggerRefresh()
    } finally {
      setActionInProgress(null)
    }
  }

  const handleStop = (id: string) => agentAction(id, 'stop')
  const handleStart = (id: string) => agentAction(id, 'start')
  const handleDelete = (id: string) => agentAction(id, 'delete')

  const getStatusBadge = (status: AgentInstance['status']) => {
    const variants: Record<
      string,
      {
        variant: 'default' | 'secondary' | 'destructive' | 'outline'
        label: string
      }
    > = {
      creating: { variant: 'secondary', label: 'Creating...' },
      running: { variant: 'default', label: 'Running' },
      stopped: { variant: 'outline', label: 'Stopped' },
      error: { variant: 'destructive', label: 'Error' },
    }
    const { variant, label } = variants[status] ?? variants.stopped
    return <Badge variant={variant}>{label}</Badge>
  }

  // Show chat view when an agent is selected
  if (chatAgent) {
    return (
      <AgentChat
        agentId={chatAgent.id}
        agentName={chatAgent.name}
        onBack={() => setChatAgentId(null)}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Agents</h1>
          <p className="text-muted-foreground text-sm">
            Create and manage OpenClaw agent instances running in Docker
            containers.
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={dockerAvailable === false}>
              <Plus className="mr-2 size-4" />
              New Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Agent</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="agent-name">
                  Agent Name
                </label>
                <Input
                  id="agent-name"
                  placeholder="e.g. work, personal, research"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                  }}
                />
              </div>

              <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="agent-provider">
                  LLM Provider
                </label>
                {compatibleProviders.length > 0 ? (
                  <>
                    <Select
                      value={selectedProviderId}
                      onValueChange={setSelectedProviderId}
                    >
                      <SelectTrigger id="agent-provider">
                        <SelectValue placeholder="Select a provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {compatibleProviders.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — {p.modelId}
                            {p.id === defaultProviderId ? ' (default)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      Uses your existing API key from BrowserOS settings. The
                      key is passed to the container and never leaves your
                      machine.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No compatible LLM providers configured.{' '}
                    <a href="#/settings/ai" className="underline">
                      Add one in AI settings
                    </a>{' '}
                    first, or create the agent without one and configure later.
                  </p>
                )}
              </div>

              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!newAgentName.trim() || creating}
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
      </div>

      {dockerAvailable === false && (
        <Card className="border-destructive/50 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-sm">Docker is not available</p>
              <p className="text-muted-foreground text-sm">
                Install{' '}
                <a
                  href="https://www.docker.com/products/docker-desktop/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Docker Desktop
                </a>{' '}
                or{' '}
                <a
                  href="https://orbstack.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  OrbStack
                </a>{' '}
                to create local OpenClaw agents.
              </p>
            </div>
          </div>
        </Card>
      )}

      {agents.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Cpu className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="font-medium text-lg">No agents yet</h3>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Create your first OpenClaw agent to get started. Each agent runs in
            an isolated Docker container with its own workspace.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Cpu className="size-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{agent.name}</span>
                      {getStatusBadge(agent.status)}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Port {agent.port}
                      {agent.status === 'running' && (
                        <> &middot; Gateway at ws://127.0.0.1:{agent.port}</>
                      )}
                    </p>
                    {agent.error && (
                      <p className="mt-1 text-destructive text-xs">
                        {agent.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {agent.status === 'running' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setChatAgentId(agent.id)}
                      title="Chat"
                    >
                      <MessageSquare className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setLogsAgentId(agent.id)}
                    title="View logs"
                  >
                    <ScrollText className="size-4" />
                  </Button>
                  {agent.status === 'running' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleStop(agent.id)}
                      disabled={actionInProgress === agent.id}
                      title="Stop"
                    >
                      <Square className="size-4" />
                    </Button>
                  )}
                  {agent.status === 'stopped' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => handleStart(agent.id)}
                      disabled={actionInProgress === agent.id}
                      title="Start"
                    >
                      <Play className="size-4" />
                    </Button>
                  )}
                  {(agent.status === 'stopped' || agent.status === 'error') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(agent.id)}
                      disabled={actionInProgress === agent.id}
                      title="Delete"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                  {actionInProgress === agent.id && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {logsAgent && (
        <AgentLogsDialog
          agentId={logsAgent.id}
          agentName={logsAgent.name}
          open={!!logsAgentId}
          onOpenChange={(isOpen) => {
            if (!isOpen) setLogsAgentId(null)
          }}
        />
      )}
    </div>
  )
}
