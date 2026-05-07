import { describe, expect, it } from 'bun:test'
import {
  buildEmptyToolResultStopContinuationPrompt,
  shouldContinueAfterEmptyToolResultStop,
} from '../../src/agents/single-agent'

describe('single-agent empty tool-result stop handling', () => {
  it('continues when the model emits an empty stop after a tool result', () => {
    expect(
      shouldContinueAfterEmptyToolResultStop({
        text: '',
        finishReason: 'stop',
        toolCalls: [],
        steps: [{ toolResults: [{ ok: true }] }, { toolResults: [] }],
      }),
    ).toBe(true)
  })

  it('does not continue for normal final text', () => {
    expect(
      shouldContinueAfterEmptyToolResultStop({
        text: 'Done',
        finishReason: 'stop',
        toolCalls: [],
        steps: [{ toolResults: [{ ok: true }] }, { toolResults: [] }],
      }),
    ).toBe(false)
  })

  it('does not continue when there was no previous tool result', () => {
    expect(
      shouldContinueAfterEmptyToolResultStop({
        text: '',
        finishReason: 'stop',
        toolCalls: [],
        steps: [{ toolResults: [] }],
      }),
    ).toBe(false)
  })

  it('builds a continuation prompt with the original task', () => {
    const prompt = buildEmptyToolResultStopContinuationPrompt(
      'Delete the target email.',
    )

    expect(prompt).toContain('Continue the eval task')
    expect(prompt).toContain('Do not stop after routine tool results')
    expect(prompt).toContain('Delete the target email.')
  })
})
