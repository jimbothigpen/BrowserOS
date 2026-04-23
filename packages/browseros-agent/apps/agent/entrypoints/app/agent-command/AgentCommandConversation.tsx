import { ArrowLeft, Bot } from 'lucide-react'
import type { FC } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  type AgentEntry,
  getModelDisplayName,
} from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { useAgentCommandData } from './agent-command-layout'
import { ClawChat } from './ClawChat'

function StatusBadge({ status }: { status: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'Working on your request'
            ? 'bg-amber-500'
            : status === 'Ready'
              ? 'bg-emerald-500'
              : status === 'Offline'
                ? 'bg-muted-foreground/50'
                : 'bg-[var(--accent-orange)]',
        )}
      />
      <span>{status}</span>
    </div>
  )
}

function AgentIdentity({
  name,
  meta,
  className,
}: {
  name: string
  meta: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-semibold text-[15px] leading-5">{name}</div>
      <div className="truncate text-muted-foreground text-xs leading-5">
        {meta}
      </div>
    </div>
  )
}

function ConversationHeader({
  agentName,
  agentMeta,
  status,
  onGoHome,
}: {
  agentName: string
  agentMeta: string
  status: string
  onGoHome: () => void
}) {
  return (
    <div className="flex h-14 items-center justify-between gap-4 border-border/50 border-b px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoHome}
          className="size-8 rounded-xl lg:hidden"
          title="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Bot className="size-4" />
        </div>
        <AgentIdentity name={agentName} meta={agentMeta} />
      </div>

      <StatusBadge status={status} />
    </div>
  )
}

function AgentRailHeader({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="hidden h-14 items-center border-border/50 border-r border-b bg-background/70 px-4 lg:flex">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoHome}
          className="size-8 rounded-xl"
          title="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="truncate font-semibold text-[15px] leading-5">
          Agents
        </div>
      </div>
    </div>
  )
}

function AgentRailList({
  activeAgentId,
  agents,
  onSelectAgent,
}: {
  activeAgentId: string
  agents: AgentEntry[]
  onSelectAgent: (entry: AgentEntry) => void
}) {
  return (
    <aside className="hidden min-h-0 flex-col border-border/50 border-r bg-background/70 lg:flex">
      <div className="styled-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {agents.map((entry) => {
          const active = entry.agentId === activeAgentId
          const modelName = getModelDisplayName(entry.model) ?? 'OpenClaw agent'

          return (
            <button
              key={entry.agentId}
              type="button"
              onClick={() => onSelectAgent(entry)}
              className={cn(
                'w-full rounded-2xl border px-3 py-3 text-left transition-all',
                active
                  ? 'border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/8 shadow-sm'
                  : 'border-transparent bg-transparent hover:border-border/60 hover:bg-card',
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl',
                    active
                      ? 'bg-[var(--accent-orange)]/12 text-[var(--accent-orange)]'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Bot className="size-4" />
                </div>
                <AgentIdentity name={entry.name} meta={modelName} />
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function getConversationStatusCopy(status: string | undefined): string {
  if (status === 'running') return 'Ready'
  if (status === 'starting') return 'Connecting'
  if (status === 'error') return 'Attention'
  if (status === 'stopped') return 'Offline'
  return 'Setup'
}

export const AgentCommandConversation: FC = () => {
  const { agentId } = useParams<{ agentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { status, agents } = useAgentCommandData()
  const shouldRedirectHome = !agentId
  const resolvedAgentId = agentId ?? ''
  const agent = agents.find((entry) => entry.agentId === resolvedAgentId)
  const agentName = agent?.name || resolvedAgentId || 'Agent'
  const agentMeta = getModelDisplayName(agent?.model) ?? 'OpenClaw agent'
  const initialMessage = searchParams.get('q')

  if (shouldRedirectHome) {
    return <Navigate to="/home" replace />
  }

  const handleSelectAgent = (entry: AgentEntry) => {
    navigate(`/home/agents/${entry.agentId}`)
  }

  const statusCopy = getConversationStatusCopy(status?.status)

  return (
    <div className="absolute inset-0 overflow-hidden bg-background md:pl-[theme(spacing.14)]">
      <div className="mx-auto grid h-full w-full max-w-[1480px] lg:grid-cols-[288px_minmax(0,1fr)] lg:grid-rows-[3.5rem_minmax(0,1fr)]">
        <AgentRailHeader onGoHome={() => navigate('/home')} />

        <ConversationHeader
          agentName={agentName}
          agentMeta={agentMeta}
          status={statusCopy}
          onGoHome={() => navigate('/home')}
        />

        <AgentRailList
          activeAgentId={resolvedAgentId}
          agents={agents}
          onSelectAgent={handleSelectAgent}
        />

        <ClawChat
          key={resolvedAgentId}
          agentId={resolvedAgentId}
          agentName={agentName}
          agents={agents}
          selectedAgentId={resolvedAgentId}
          onSelectAgent={handleSelectAgent}
          onCreateAgent={() => navigate('/agents')}
          disabled={status?.status !== 'running'}
          status={status?.status}
          initialMessage={initialMessage}
          onInitialMessageConsumed={() =>
            setSearchParams({}, { replace: true })
          }
        />
      </div>
    </div>
  )
}
