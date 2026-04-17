import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  getLatestConversation,
  saveConversation,
} from '../../../lib/agent-conversations/storage'
import type {
  AgentConversation,
  AgentConversationTurn,
  AssistantPart,
} from '../../../lib/agent-conversations/types'
import { consumeSSEStream } from '../../../lib/sse'
import {
  type AgentConversationMessage,
  chatWithAgent,
} from '../agents/useAgents'
import { applyUiEventToParts } from './stream-to-parts'

export function useAgentConversation(agentId: string, agentName: string) {
  const [turns, setTurns] = useState<AgentConversationTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [loading, setLoading] = useState(true)
  const sessionKeyRef = useRef('')
  const agentIdRef = useRef(agentId)
  const previousAgentIdRef = useRef(agentId)
  const lastPersistedTurnIdRef = useRef<string | null>(null)
  const turnsRef = useRef<AgentConversationTurn[]>([])
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamTokenRef = useRef(0)
  agentIdRef.current = agentId

  useLayoutEffect(() => {
    const agentChanged = previousAgentIdRef.current !== agentId
    previousAgentIdRef.current = agentId
    if (!agentChanged) {
      return
    }

    streamTokenRef.current += 1
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    lastPersistedTurnIdRef.current = null
    setTurns([])
    setStreaming(false)
    setLoading(true)
  }, [agentId])

  useEffect(() => {
    let active = true
    const isCurrentAgent = () => active && agentIdRef.current === agentId

    getLatestConversation(agentId)
      .then((conv) => {
        if (!isCurrentAgent()) return
        if (conv) {
          setTurns(conv.turns)
          sessionKeyRef.current = conv.sessionKey
          lastPersistedTurnIdRef.current =
            conv.turns[conv.turns.length - 1]?.id ?? null
        } else {
          sessionKeyRef.current = crypto.randomUUID()
          lastPersistedTurnIdRef.current = null
        }
        setLoading(false)
      })
      .catch(() => {
        if (isCurrentAgent()) {
          sessionKeyRef.current = crypto.randomUUID()
          lastPersistedTurnIdRef.current = null
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [agentId])

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    turnsRef.current = turns
  }, [turns])

  useEffect(() => {
    const lastTurn = turns[turns.length - 1]
    if (!lastTurn?.done) {
      return
    }

    if (lastPersistedTurnIdRef.current === lastTurn.id) {
      return
    }

    lastPersistedTurnIdRef.current = lastTurn.id
    const conversation: AgentConversation = {
      agentId,
      agentName,
      sessionKey: sessionKeyRef.current,
      turns,
      createdAt: turns[0]?.timestamp ?? Date.now(),
      updatedAt: Date.now(),
    }
    saveConversation(conversation).catch(() => {})
  }, [agentId, agentName, turns])

  const updateCurrentTurnParts = (
    updater: (parts: AssistantPart[]) => AssistantPart[],
  ) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1]
      if (!last) return prev
      return [...prev.slice(0, -1), { ...last, parts: updater(last.parts) }]
    })
  }

  const processStreamEvent = (event: UIMessageStreamEvent) => {
    if (isTerminalConversationEvent(event)) {
      finalizeCurrentTurn((parts) =>
        applyTerminalEventToCurrentTurn(parts, event),
      )
      return
    }

    updateCurrentTurnParts((parts) => applyUiEventToCurrentTurn(parts, event))
  }

  const send = async (text: string) => {
    if (!text.trim() || streaming) return

    const userText = text.trim()
    const conversation = buildConversationHistory(turnsRef.current)
    const streamToken = streamTokenRef.current + 1
    streamTokenRef.current = streamToken
    const turn: AgentConversationTurn = {
      id: crypto.randomUUID(),
      userText,
      parts: [],
      done: false,
      timestamp: Date.now(),
    }
    setTurns((prev) => [...prev, turn])
    setStreaming(true)
    const abortController = new AbortController()
    streamAbortRef.current = abortController
    const isCurrentStream = () =>
      streamTokenRef.current === streamToken && agentIdRef.current === agentId

    try {
      const response = await chatWithAgent(agentId, {
        message: userText,
        sessionKey: sessionKeyRef.current,
        conversation,
        signal: abortController.signal,
      })
      if (!isCurrentStream()) {
        return
      }
      if (!response.ok) {
        const errorText = await readErrorMessage(response)
        if (!isCurrentStream()) {
          return
        }
        finalizeCurrentTurn((parts) =>
          applyTerminalEventToCurrentTurn(parts, {
            type: 'error',
            errorText,
          }),
        )
        return
      }
      await consumeSSEStream<UIMessageStreamEvent>(
        response,
        (event) => {
          if (!isCurrentStream()) {
            return
          }
          processStreamEvent(event)
        },
        abortController.signal,
      )
    } catch (err) {
      if (abortController.signal.aborted) return
      if (!isCurrentStream()) {
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      finalizeCurrentTurn((parts) =>
        applyTerminalEventToCurrentTurn(parts, {
          type: 'error',
          errorText: msg,
        }),
      )
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null
      }
      if (isCurrentStream()) {
        setStreaming(false)
      }
    }
  }

  const resetConversation = () => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    lastPersistedTurnIdRef.current = null
    setTurns([])
    setStreaming(false)
    sessionKeyRef.current = crypto.randomUUID()
  }

  const finalizeCurrentTurn = (
    updater: (parts: AssistantPart[]) => AssistantPart[],
  ) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1]
      if (!last) return prev
      const updated = [
        ...prev.slice(0, -1),
        {
          ...last,
          parts: updater(last.parts),
          done: true,
        },
      ]
      return updated
    })
  }

  return {
    turns,
    streaming,
    loading,
    sessionKey: sessionKeyRef.current,
    send,
    resetConversation,
  }
}

export function applyUiEventToCurrentTurn(
  parts: AssistantPart[],
  event: UIMessageStreamEvent,
): AssistantPart[] {
  return applyUiEventToParts(parts, event)
}

export function applyTerminalEventToCurrentTurn(
  parts: AssistantPart[],
  event: Extract<UIMessageStreamEvent, { type: 'finish' | 'abort' | 'error' }>,
): AssistantPart[] {
  if (event.type === 'error') {
    return applyUiEventToParts(applyUiEventToParts(parts, event), {
      type: 'finish',
      finishReason: 'error',
    })
  }

  return applyUiEventToParts(parts, event)
}

export function applyUiEventToConversationTurn(
  turn: AgentConversationTurn,
  event: UIMessageStreamEvent,
): AgentConversationTurn {
  return {
    ...turn,
    parts: isTerminalConversationEvent(event)
      ? applyTerminalEventToCurrentTurn(turn.parts, event)
      : applyUiEventToCurrentTurn(turn.parts, event),
    done: turn.done || isTerminalConversationEvent(event),
  }
}

export function isTerminalConversationEvent(
  event: UIMessageStreamEvent,
): event is Extract<
  UIMessageStreamEvent,
  { type: 'finish' | 'abort' | 'error' }
> {
  return (
    event.type === 'finish' || event.type === 'abort' || event.type === 'error'
  )
}

function buildConversationHistory(
  turns: AgentConversationTurn[],
): AgentConversationMessage[] {
  const conversation: AgentConversationMessage[] = []

  for (const turn of turns) {
    conversation.push({
      role: 'user',
      text: turn.userText,
    })

    const assistantText = turn.parts
      .filter(
        (part): part is Extract<AssistantPart, { kind: 'text' }> =>
          part.kind === 'text',
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n\n')

    if (assistantText) {
      conversation.push({
        role: 'assistant',
        text: assistantText,
      })
    }
  }

  return conversation
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) {
      return body.error
    }
  } catch {}

  try {
    return (
      (await response.text()) || `Request failed with status ${response.status}`
    )
  } catch {
    return `Request failed with status ${response.status}`
  }
}
