import { Bot, Home, RotateCcw } from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import type { AgentEntry } from '@/entrypoints/app/agents/useAgents'
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
    <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/95 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
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
            <div className="truncate font-semibold text-sm">{agentName}</div>
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
  agent: AgentEntry | undefined,
  status: string | undefined,
  streaming: boolean,
): string {
  if (streaming) return 'Working on your request'
  if (!agent || agent.adapterType !== 'openclaw') {
    return 'Ready for the next task'
  }
  if (status === 'running') return 'Ready for the next task'
  if (status === 'starting') return 'Connecting to OpenClaw'
  if (status === 'error') return 'OpenClaw needs attention'
  if (status === 'stopped') return 'OpenClaw is offline'
  return 'Open Agents to continue'
}

function canChatWithAgent(
  agent: AgentEntry | undefined,
  status: string | undefined,
): boolean {
  if (!agent || agent.adapterType !== 'openclaw') {
    return true
  }

  return status === 'running'
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
    const target = searchParams.get('from')
      ? `/home/agents/${entry.agentId}?from=${encodeURIComponent(
          searchParams.get('from') ?? '',
        )}`
      : `/home/agents/${entry.agentId}`
    navigate(target)
  }

  const statusCopy = getConversationStatusCopy(agent, status?.status, streaming)
  const inputDisabled = !canChatWithAgent(agent, status?.status)
  const agentStatus =
    agent?.adapterType === 'openclaw' ? status?.status : 'running'
  const returnTo = searchParams.get('from') === 'agents' ? '/agents' : '/home'

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="fade-in slide-in-from-bottom-5 mx-auto flex h-full w-full max-w-3xl animate-in flex-col gap-3 px-4 pt-4 pb-2 duration-300">
        <ConversationHeader
          agentName={agentName}
          status={statusCopy}
          onGoHome={() => navigate(returnTo)}
          onReset={resetConversation}
        />

        <main
          ref={scrollRef}
          className={cn(
            'styled-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[1.5rem] border border-border/50 bg-card/85 px-5 py-5 shadow-sm',
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
            <div className="w-full space-y-4">
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

        <div className="w-full flex-shrink-0">
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
            disabled={inputDisabled}
            status={agentStatus}
            placeholder={`Message ${agentName}...`}
          />
        </div>
      </div>
    </div>
  )
}
