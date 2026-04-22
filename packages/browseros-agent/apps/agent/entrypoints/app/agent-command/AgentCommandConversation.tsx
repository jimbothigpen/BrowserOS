import {
  ArrowLeft,
  Bot,
  Clock3,
  Home,
  MessageSquareText,
  RotateCcw,
} from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  type AgentEntry,
  getModelDisplayName,
} from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { useAgentCommandData } from './agent-command-layout'
import { ConversationInput } from './ConversationInput'
import { ConversationMessage } from './ConversationMessage'
import { useAgentConversation } from './useAgentConversation'

function ConversationHeader({
  agentName,
  status,
  onGoHome,
  onReset,
}: {
  agentName: string
  status: string
  onGoHome: () => void
  onReset: () => void
}) {
  return (
    <div className="overflow-hidden border-border/50 border-b px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onGoHome}
            className="rounded-xl"
            title="Back to home"
          >
            <Home className="size-4" />
          </Button>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-base">{agentName}</div>
            <div className="truncate text-muted-foreground text-sm">
              {status}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="rounded-xl text-muted-foreground"
        >
          <RotateCcw className="mr-2 size-4" />
          New conversation
        </Button>
      </div>
    </div>
  )
}

function ConversationSidebar({
  activeAgentId,
  agents,
  onGoHome,
  onSelectAgent,
}: {
  activeAgentId: string
  agents: AgentEntry[]
  onGoHome: () => void
  onSelectAgent: (entry: AgentEntry) => void
}) {
  return (
    <aside className="hidden h-full rounded-[1.75rem] border border-border/60 bg-card/95 p-4 shadow-sm backdrop-blur lg:flex lg:flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Agent Thread
          </p>
          <h2 className="mt-2 font-semibold text-lg">New tab chat</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Stay in the conversation instead of hopping between tools.
          </p>
        </div>
        <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-orange)]/12 text-[var(--accent-orange)]">
          <MessageSquareText className="size-5" />
        </div>
      </div>

      <Button
        variant="outline"
        onClick={onGoHome}
        className="mt-4 justify-start rounded-2xl"
      >
        <ArrowLeft className="mr-2 size-4" />
        Back to inbox
      </Button>

      <Separator className="my-4" />

      <div className="space-y-2">
        {agents.map((entry) => {
          const active = entry.agentId === activeAgentId
          return (
            <button
              key={entry.agentId}
              type="button"
              onClick={() => onSelectAgent(entry)}
              className={cn(
                'w-full rounded-2xl border px-3 py-3 text-left transition-all',
                active
                  ? 'border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/8 shadow-sm'
                  : 'border-border/60 bg-background/60 hover:border-border hover:bg-background',
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
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">
                    {entry.name}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {getModelDisplayName(entry.model) ?? 'OpenClaw agent'}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-auto rounded-2xl border border-border/60 bg-background/70 p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.18em]">
          <Clock3 className="size-3.5 text-[var(--accent-orange)]" />
          UI direction
        </div>
        <p className="mt-3 text-muted-foreground text-sm leading-6">
          This draft prioritizes a thread-like workspace with agent switching on
          the side and the active conversation occupying the main canvas.
        </p>
      </div>
    </aside>
  )
}

function EmptyConversationState({ agentName }: { agentName: string }) {
  return (
    <div className="flex min-h-full items-center justify-center py-10">
      <div className="max-w-md rounded-[1.5rem] border border-border/60 bg-card/90 px-8 py-10 text-center shadow-sm backdrop-blur">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Bot className="size-6" />
        </div>
        <h2 className="mt-4 font-semibold text-lg">{agentName}</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Send a message to start a focused conversation with this agent.
        </p>
      </div>
    </div>
  )
}

function getConversationStatusCopy(
  status: string | undefined,
  streaming: boolean,
): string {
  if (streaming) return 'Working on your request'
  if (status === 'running') return 'Ready for the next task'
  if (status === 'starting') return 'Connecting to OpenClaw'
  if (status === 'error') return 'OpenClaw needs attention'
  if (status === 'stopped') return 'OpenClaw is offline'
  return 'Open agent setup to continue'
}

export const AgentCommandConversation: FC = () => {
  const { agentId } = useParams<{ agentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialQuerySent = useRef(false)
  const { status, agents } = useAgentCommandData()
  const shouldRedirectHome = !agentId
  const resolvedAgentId = agentId ?? ''
  const agent = agents.find((entry) => entry.agentId === resolvedAgentId)
  const agentName = agent?.name || resolvedAgentId || 'Agent'
  const { turns, streaming, loading, send, resetConversation } =
    useAgentConversation(resolvedAgentId, agentName)
  const lastTurn = turns[turns.length - 1]
  const lastTurnPartCount = lastTurn?.parts.length ?? 0

  useEffect(() => {
    if (shouldRedirectHome) return

    const query = searchParams.get('q')
    if (query && !initialQuerySent.current && !loading) {
      initialQuerySent.current = true
      setSearchParams({}, { replace: true })
      void send(query)
    }
  }, [loading, searchParams, send, setSearchParams, shouldRedirectHome])

  useEffect(() => {
    if (
      shouldRedirectHome ||
      (turns.length === 0 && lastTurnPartCount === 0 && !streaming)
    ) {
      return
    }

    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [lastTurnPartCount, shouldRedirectHome, streaming, turns.length])

  if (shouldRedirectHome) {
    return <Navigate to="/home" replace />
  }

  const handleSelectAgent = (entry: AgentEntry) => {
    navigate(`/home/agents/${entry.agentId}`)
  }

  const statusCopy = getConversationStatusCopy(status?.status, streaming)

  return (
    <div className="absolute inset-0 overflow-hidden px-4 py-4">
      <div className="fade-in slide-in-from-bottom-5 mx-auto grid h-full w-full max-w-6xl animate-in gap-4 duration-300 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ConversationSidebar
          activeAgentId={resolvedAgentId}
          agents={agents}
          onGoHome={() => navigate('/home')}
          onSelectAgent={handleSelectAgent}
        />

        <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/60 bg-card/95 shadow-sm backdrop-blur">
          <ConversationHeader
            agentName={agentName}
            status={statusCopy}
            onGoHome={() => navigate('/home')}
            onReset={resetConversation}
          />

          <main
            ref={scrollRef}
            className={cn(
              'styled-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-b from-[var(--accent-orange)]/5 via-transparent to-transparent px-5 py-5',
              '[&_[data-streamdown="code-block"]]:!max-w-full [&_[data-streamdown="table-wrapper"]]:!max-w-full [&_[data-streamdown="code-block"]]:overflow-x-auto [&_[data-streamdown="table-wrapper"]]:overflow-x-auto',
            )}
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Loading conversation...
              </div>
            ) : turns.length === 0 ? (
              <EmptyConversationState agentName={agentName} />
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-4">
                {turns.map((turn, index) => (
                  <ConversationMessage
                    key={turn.id}
                    turn={turn}
                    streaming={streaming && index === turns.length - 1}
                  />
                ))}
              </div>
            )}
          </main>

          <div className="w-full flex-shrink-0 border-border/50 border-t bg-background/70 p-4">
            <div className="mx-auto max-w-3xl">
              <ConversationInput
                variant="conversation"
                agents={agents}
                selectedAgentId={resolvedAgentId}
                onSelectAgent={handleSelectAgent}
                onSend={(text) => {
                  void send(text)
                }}
                onCreateAgent={() => navigate('/agents')}
                streaming={streaming}
                disabled={status?.status !== 'running'}
                status={status?.status}
                placeholder={`Message ${agentName}...`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
