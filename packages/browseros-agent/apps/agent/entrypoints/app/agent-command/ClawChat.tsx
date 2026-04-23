import { useQueryClient } from '@tanstack/react-query'
import { Bot, Loader2, RefreshCw } from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import type { AgentEntry } from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { ClawChatMessage } from './ClawChatMessage'
import { ConversationInput } from './ConversationInput'
import { ConversationMessage } from './ConversationMessage'
import {
  buildChatHistoryFromClawMessages,
  flattenHistoryPages,
} from './claw-chat-types'
import { useAgentConversation } from './useAgentConversation'
import {
  CLAW_CHAT_QUERY_KEYS,
  useClawAgentSession,
  useClawChatHistory,
} from './useClawChatHistory'

interface ClawChatProps {
  agentId: string
  agentName: string
  agents: AgentEntry[]
  selectedAgentId: string
  onSelectAgent: (agent: AgentEntry) => void
  onCreateAgent: () => void
  disabled?: boolean
  status?: string
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
  className?: string
}

function EmptyConversationState({ agentName }: { agentName: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
          <Bot className="size-6" />
        </div>
        <h2 className="mt-5 font-semibold text-xl">{agentName}</h2>
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          Ask {agentName} to start a task.
        </p>
      </div>
    </div>
  )
}

function LoadingConversationState() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="size-4 animate-spin" />
      Loading conversation...
    </div>
  )
}

function ConversationErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <div className="max-w-md rounded-2xl border border-border/60 bg-card px-5 py-4 text-center shadow-sm">
        <p className="text-sm">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      </div>
    </div>
  )
}

export const ClawChat: FC<ClawChatProps> = ({
  agentId,
  agentName,
  agents,
  selectedAgentId,
  onSelectAgent,
  onCreateAgent,
  disabled,
  status,
  initialMessage,
  onInitialMessageConsumed,
  className,
}) => {
  const queryClient = useQueryClient()
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const initialMessageSentRef = useRef(false)
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null)

  const sessionQuery = useClawAgentSession(agentId)
  const resolvedSessionKey =
    activeSessionKey ?? sessionQuery.data?.sessionKey ?? null
  const historyQuery = useClawChatHistory({
    agentId,
    sessionKey: resolvedSessionKey,
    enabled: Boolean(resolvedSessionKey),
  })

  const historyMessages = useMemo(
    () => flattenHistoryPages(historyQuery.data?.pages ?? []),
    [historyQuery.data?.pages],
  )
  const chatHistory = useMemo(
    () => buildChatHistoryFromClawMessages(historyMessages),
    [historyMessages],
  )

  const { turns, streaming, send } = useAgentConversation(agentId, {
    sessionKey: resolvedSessionKey,
    history: chatHistory,
    onSessionKeyChange: (sessionKey) => {
      setActiveSessionKey(sessionKey)
      void queryClient.invalidateQueries({
        queryKey: [CLAW_CHAT_QUERY_KEYS.session],
      })
    },
    onStreamComplete: () => {
      return queryClient.invalidateQueries({
        queryKey: [CLAW_CHAT_QUERY_KEYS.history],
      })
    },
  })

  const hasMessages = historyMessages.length > 0 || turns.length > 0
  const isInitialLoading =
    sessionQuery.isLoading ||
    (Boolean(resolvedSessionKey) && historyQuery.isLoading)
  const error = sessionQuery.error ?? historyQuery.error

  useEffect(() => {
    if (!sessionQuery.data?.sessionKey) return
    setActiveSessionKey(sessionQuery.data.sessionKey)
  }, [sessionQuery.data?.sessionKey])

  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (
          !entry?.isIntersecting ||
          !historyQuery.hasNextPage ||
          historyQuery.isFetchingNextPage
        ) {
          return
        }

        void historyQuery.fetchNextPage()
      },
      {
        root: null,
        rootMargin: '160px 0px 0px 0px',
        threshold: 0,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [
    historyQuery.fetchNextPage,
    historyQuery.hasNextPage,
    historyQuery.isFetchingNextPage,
  ])

  useEffect(() => {
    const query = initialMessage?.trim()
    const historyReady =
      !resolvedSessionKey || historyQuery.isFetched || historyQuery.isError
    if (
      !query ||
      initialMessageSentRef.current ||
      disabled ||
      sessionQuery.isLoading ||
      !historyReady ||
      streaming
    ) {
      return
    }

    initialMessageSentRef.current = true
    onInitialMessageConsumed?.()
    void send(query)
  }, [
    historyQuery.isError,
    historyQuery.isFetched,
    initialMessage,
    onInitialMessageConsumed,
    resolvedSessionKey,
    send,
    sessionQuery.isLoading,
    streaming,
    disabled,
  ])

  const retry = () => {
    void sessionQuery.refetch()
    void historyQuery.refetch()
  }

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
    >
      <Conversation
        className={cn(
          'bg-background',
          '[&_[data-streamdown="code-block"]]:!w-full [&_[data-streamdown="code-block"]]:!max-w-full [&_[data-streamdown="table-wrapper"]]:!w-full [&_[data-streamdown="table-wrapper"]]:!max-w-full [&_[data-streamdown="code-block"]]:overflow-x-auto [&_[data-streamdown="table-wrapper"]]:overflow-x-auto',
        )}
      >
        <ConversationContent className="min-h-full px-5 py-5">
          {isInitialLoading ? (
            <LoadingConversationState />
          ) : error && !hasMessages ? (
            <ConversationErrorState message={error.message} onRetry={retry} />
          ) : !hasMessages ? (
            <EmptyConversationState agentName={agentName} />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <div ref={topSentinelRef} aria-hidden="true" className="h-px" />
              {historyQuery.isFetchingNextPage ? (
                <div className="flex justify-center py-2 text-muted-foreground text-xs">
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Loading older messages...
                </div>
              ) : null}
              {!historyQuery.hasNextPage && historyMessages.length > 0 ? (
                <div className="py-1 text-center text-muted-foreground text-xs">
                  Start of conversation
                </div>
              ) : null}
              {historyMessages.map((message) => (
                <ClawChatMessage key={message.id} message={message} />
              ))}
              {turns.map((turn, index) => (
                <ConversationMessage
                  key={turn.id}
                  turn={turn}
                  streaming={streaming && index === turns.length - 1}
                />
              ))}
              {error ? (
                <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-muted-foreground text-sm">
                  {error.message}
                </div>
              ) : null}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-border/50 border-t bg-background/88 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto max-w-3xl">
          <ConversationInput
            variant="conversation"
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            onSend={(text) => {
              void send(text)
            }}
            onCreateAgent={onCreateAgent}
            streaming={streaming}
            disabled={disabled}
            status={status}
            placeholder={`Message ${agentName}...`}
          />
        </div>
      </div>
    </div>
  )
}
