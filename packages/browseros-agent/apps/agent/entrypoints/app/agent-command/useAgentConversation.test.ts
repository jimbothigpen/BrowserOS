import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { AgentConversationTurn } from '@/lib/agent-conversations/types'

describe('useAgentConversation helpers', () => {
  afterEach(() => {
    mock.restore()
  })

  it('treats error events as terminal and finalizes the current turn without a finish event', async () => {
    mock.module('../agents/useAgents', () => ({
      chatWithAgent: mock(async () => {
        throw new Error('not used')
      }),
    }))

    const { applyUiEventToConversationTurn, isTerminalConversationEvent } =
      (await import(
        './useAgentConversation'
      )) as typeof import('./useAgentConversation')
    const turn = createTurn()

    const updated = applyUiEventToConversationTurn(turn, {
      type: 'error',
      errorText: 'Gateway unavailable',
    })

    expect(
      isTerminalConversationEvent({ type: 'error', errorText: 'boom' }),
    ).toBe(true)
    expect(updated).toEqual({
      ...turn,
      done: true,
      parts: [
        { kind: 'thinking', text: 'Inspecting context', done: true },
        { kind: 'text', text: 'Error: Gateway unavailable' },
      ],
    })
  })
})

function createTurn(): AgentConversationTurn {
  return {
    id: 'turn-1',
    userText: 'hello',
    parts: [{ kind: 'thinking', text: 'Inspecting context', done: false }],
    done: false,
    timestamp: 1,
  }
}
