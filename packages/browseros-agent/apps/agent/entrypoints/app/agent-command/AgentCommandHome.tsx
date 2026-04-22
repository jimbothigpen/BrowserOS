import {
  ArrowRight,
  Bot,
  Clock3,
  MessageSquareText,
  Sparkles,
} from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type {
  AgentEntry,
  OpenClawStatus,
} from '@/entrypoints/app/agents/useOpenClaw'
import { ImportDataHint } from '@/entrypoints/newtab/index/ImportDataHint'
import { NewTabTip } from '@/entrypoints/newtab/index/NewTabTip'
import { SignInHint } from '@/entrypoints/newtab/index/SignInHint'
import { useActiveHint } from '@/entrypoints/newtab/index/useActiveHint'
import { useAgentCommandData } from './agent-command-layout'
import { ConversationInput } from './ConversationInput'
import { useAgentCardData } from './useAgentCardData'

function AgentCommandSetupState({
  onOpenAgents,
}: {
  onOpenAgents: () => void
}) {
  return (
    <Card className="border-border/60 bg-card/85 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="max-w-xl text-muted-foreground text-sm">
          Set up OpenClaw agents to turn your new tab into an agent command
          center.
        </p>
        <Button onClick={onOpenAgents} className="gap-2">
          Open Agent Setup
          <ArrowRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

function EmptyAgentsState({ onOpenAgents }: { onOpenAgents: () => void }) {
  return (
    <Card className="border-border/60 bg-card/85 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="max-w-xl text-muted-foreground text-sm">
          OpenClaw is running, but you do not have any agents yet.
        </p>
        <Button variant="outline" onClick={onOpenAgents}>
          Create your first agent
        </Button>
      </CardContent>
    </Card>
  )
}

function OpenClawUnavailableState({
  onOpenAgents,
}: {
  onOpenAgents: () => void
}) {
  return (
    <Card className="border-border/60 bg-card/85 shadow-sm">
      <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
        <p className="max-w-xl text-muted-foreground text-sm">
          OpenClaw is unavailable right now. Open the Agents page to restart the
          gateway or review setup.
        </p>
        <Button onClick={onOpenAgents} className="gap-2">
          Open Agent Setup
          <ArrowRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

function getStatusCopy(status: OpenClawStatus['status'] | undefined): string {
  if (status === 'running') return 'Ready'
  if (status === 'starting') return 'Connecting'
  if (status === 'error') return 'Needs attention'
  if (status === 'stopped') return 'Offline'
  return 'Setup required'
}

function getStatusTone(status: OpenClawStatus['status'] | undefined): string {
  if (status === 'running') return 'bg-emerald-500'
  if (status === 'starting') return 'bg-amber-500'
  if (status === 'error') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

function InboxSidebar({
  activeAgentId,
  agents,
  onCreateAgent,
  onSelectAgent,
}: {
  activeAgentId: string | null
  agents: ReturnType<typeof useAgentCardData>
  onCreateAgent: () => void
  onSelectAgent: (agentId: string) => void
}) {
  return (
    <aside className="rounded-[1.75rem] border border-border/60 bg-card/95 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Agent Inbox
          </p>
          <h2 className="mt-2 font-semibold text-lg">Recent agents</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Jump into the thread you want to continue.
          </p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-orange)]/12 text-[var(--accent-orange)]">
          <MessageSquareText className="size-5" />
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex flex-col gap-2">
        {agents.map((agent) => (
          <button
            key={agent.agentId}
            type="button"
            onClick={() => onSelectAgent(agent.agentId)}
            className={`rounded-2xl border px-3 py-3 text-left transition-all ${
              agent.agentId === activeAgentId
                ? 'border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/8 shadow-sm'
                : 'border-border/60 bg-background/60 hover:border-border hover:bg-background'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{agent.name}</div>
                <div className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
                  {agent.lastMessage ?? 'No conversation yet.'}
                </div>
              </div>
              <span
                className={`mt-1 size-2 shrink-0 rounded-full ${
                  agent.status === 'working'
                    ? 'bg-amber-500'
                    : agent.status === 'error'
                      ? 'bg-destructive'
                      : 'bg-emerald-500'
                }`}
              />
            </div>
          </button>
        ))}
      </div>

      <Button
        variant="outline"
        onClick={onCreateAgent}
        className="mt-4 w-full rounded-2xl"
      >
        Create agent
      </Button>
    </aside>
  )
}

function AgentLaunchPanel({
  agentName,
  lastMessage,
  lastMessageTimestamp,
  onOpenThread,
  status,
}: {
  agentName: string
  lastMessage?: string
  lastMessageTimestamp?: number
  onOpenThread: () => void
  status: OpenClawStatus['status'] | undefined
}) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-border/60 bg-card/95 shadow-sm backdrop-blur">
      <div className="relative overflow-hidden border-border/50 border-b px-6 py-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--accent-orange)]/12 via-[var(--accent-orange)]/4 to-transparent" />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-muted-foreground text-xs">
              <span
                className={`size-2 rounded-full ${getStatusTone(status)}`}
              />
              <span>{getStatusCopy(status)}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-muted-foreground text-xs">
              <Bot className="size-3.5" />
              <span>{agentName}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.28em]">
              New Tab Chat
            </p>
            <h1 className="max-w-2xl font-semibold text-3xl leading-tight">
              Start the next task without leaving the new tab.
            </h1>
            <p className="max-w-2xl text-muted-foreground text-sm leading-6">
              This draft keeps the flow focused around a single agent thread.
              Pick your agent, type the request, and continue the conversation
              in a dedicated chat view.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.18em]">
                <Sparkles className="size-3.5 text-[var(--accent-orange)]" />
                Selected agent
              </div>
              <div className="mt-3 font-medium text-sm">{agentName}</div>
              <p className="mt-1 text-muted-foreground text-sm">
                Ready to handle the next thread from here.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.18em]">
                <MessageSquareText className="size-3.5 text-[var(--accent-orange)]" />
                Recent summary
              </div>
              <p className="mt-3 line-clamp-3 text-foreground/85 text-sm leading-6">
                {lastMessage ?? 'No conversation history yet for this agent.'}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.18em]">
                <Clock3 className="size-3.5 text-[var(--accent-orange)]" />
                Last active
              </div>
              <p className="mt-3 text-foreground/85 text-sm">
                {lastMessageTimestamp
                  ? new Date(lastMessageTimestamp).toLocaleString()
                  : 'Waiting for the first task'}
              </p>
              <Button
                variant="ghost"
                onClick={onOpenThread}
                className="mt-3 h-auto rounded-xl px-0 text-[var(--accent-orange)] hover:bg-transparent hover:text-[var(--accent-orange)]"
              >
                Open active thread
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const activeHint = useActiveHint()
  const { status, agents } = useAgentCommandData()
  const [mounted, setMounted] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const cardData = useAgentCardData(agents, status?.status)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId) {
        setSelectedAgentId(null)
      }
      return
    }

    if (
      !selectedAgentId ||
      !agents.some((agent) => agent.agentId === selectedAgentId)
    ) {
      setSelectedAgentId(agents[0].agentId)
    }
  }, [agents, selectedAgentId])

  const handleSend = (text: string) => {
    if (!selectedAgentId) return
    navigate(`/home/agents/${selectedAgentId}?q=${encodeURIComponent(text)}`)
  }

  const handleSelectAgent = (agent: AgentEntry) => {
    setSelectedAgentId(agent.agentId)
  }

  const openClawStatus = status?.status
  const isSetup = openClawStatus != null && openClawStatus !== 'uninitialized'
  const shouldShowUnavailableState =
    openClawStatus != null &&
    openClawStatus !== 'running' &&
    openClawStatus !== 'uninitialized' &&
    cardData.length === 0
  const selectedCard =
    cardData.find((agent) => agent.agentId === selectedAgentId) ?? cardData[0]

  return (
    <div className="min-h-full px-4 py-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        {isSetup && cardData.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <InboxSidebar
              activeAgentId={selectedAgentId}
              agents={cardData}
              onCreateAgent={() => navigate('/agents')}
              onSelectAgent={(agentId) => setSelectedAgentId(agentId)}
            />

            <div className="space-y-4">
              <AgentLaunchPanel
                agentName={selectedCard?.name ?? 'Agent'}
                lastMessage={selectedCard?.lastMessage}
                lastMessageTimestamp={selectedCard?.lastMessageTimestamp}
                onOpenThread={() => {
                  if (selectedCard?.agentId) {
                    navigate(`/home/agents/${selectedCard.agentId}`)
                  }
                }}
                status={status?.status}
              />

              <ConversationInput
                variant="home"
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={handleSelectAgent}
                onSend={handleSend}
                onCreateAgent={() => navigate('/agents')}
                streaming={false}
                disabled={status?.status !== 'running'}
                status={status?.status}
                placeholder={
                  status?.status === 'running'
                    ? `Ask ${selectedCard?.name ?? 'your agent'} to handle the next task...`
                    : 'OpenClaw is not running...'
                }
              />

              {mounted ? <NewTabTip /> : null}
            </div>
          </div>
        ) : isSetup ? (
          shouldShowUnavailableState ? (
            <OpenClawUnavailableState
              onOpenAgents={() => navigate('/agents')}
            />
          ) : (
            <EmptyAgentsState onOpenAgents={() => navigate('/agents')} />
          )
        ) : (
          <AgentCommandSetupState onOpenAgents={() => navigate('/agents')} />
        )}
      </div>

      {activeHint === 'signin' ? <SignInHint /> : null}
      {activeHint === 'import' ? <ImportDataHint /> : null}
    </div>
  )
}
