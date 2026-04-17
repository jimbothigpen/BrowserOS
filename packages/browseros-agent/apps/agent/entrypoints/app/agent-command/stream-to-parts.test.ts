import { describe, expect, it } from 'bun:test'
import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { AssistantPart } from '@/lib/agent-conversations/types'
import { applyUiEventToParts } from './stream-to-parts'

describe('applyUiEventToParts', () => {
  it('builds text, thinking, tool batch, and error parts from UI stream events', () => {
    let parts: AssistantPart[] = []

    for (const event of createEvents()) {
      parts = applyUiEventToParts(parts, event)
    }

    expect(parts).toEqual([
      { kind: 'thinking', text: 'Inspecting context', done: true },
      {
        kind: 'tool-batch',
        tools: [
          {
            id: 'call-1',
            name: 'browser.search',
            status: 'completed',
            durationMs: 1250,
            input: { query: 'BrowserOS' },
            output: { status: 'completed', result: 'ok', durationMs: 1250 },
          },
        ],
      },
      { kind: 'text', text: 'Hello world' },
      { kind: 'text', text: 'Error: Something went wrong' },
    ])
  })

  it('keeps streaming reasoning and tool state open until completion events arrive', () => {
    let parts: AssistantPart[] = []

    parts = applyUiEventToParts(parts, {
      type: 'reasoning-delta',
      id: 'reasoning-1',
      delta: 'Thinking...',
    })
    parts = applyUiEventToParts(parts, {
      type: 'tool-input-start',
      toolCallId: 'call-1',
      toolName: 'browser.search',
    })
    parts = applyUiEventToParts(parts, {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { partial: true },
    })

    expect(parts).toEqual([
      { kind: 'thinking', text: 'Thinking...', done: false },
      {
        kind: 'tool-batch',
        tools: [
          {
            id: 'call-1',
            name: 'browser.search',
            status: 'running',
            output: { partial: true },
          },
        ],
      },
    ])
  })
})

function createEvents(): UIMessageStreamEvent[] {
  return [
    { type: 'start' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'Inspecting ' },
    { type: 'reasoning-delta', id: 'reasoning-1', delta: 'context' },
    {
      type: 'tool-input-start',
      toolCallId: 'call-1',
      toolName: 'browser.search',
    },
    {
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'browser.search',
      input: { query: 'BrowserOS' },
    },
    {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { result: 'ok', durationMs: 1250 },
    },
    {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { status: 'completed' },
    },
    { type: 'reasoning-end', id: 'reasoning-1' },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'Hello' },
    { type: 'text-delta', id: 'text-1', delta: ' world' },
    { type: 'text-end', id: 'text-1' },
    { type: 'error', errorText: 'Something went wrong' },
    { type: 'finish', finishReason: 'error' },
  ]
}
