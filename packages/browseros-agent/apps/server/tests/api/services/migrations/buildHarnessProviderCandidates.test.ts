/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import {
  buildHarnessProviderCandidates,
  harnessRowToCandidate,
} from '../../../../src/api/services/migrations/buildHarnessProviderCandidates'
import type { AgentDefinitionRow } from '../../../../src/lib/db/schema/agents'

function makeRow(
  overrides: Partial<AgentDefinitionRow> = {},
): AgentDefinitionRow {
  return {
    id: 'agent-1',
    name: 'Claude Code',
    adapter: 'claude',
    modelId: 'claude-sonnet-4-6',
    reasoningEffort: 'medium',
    permissionMode: 'approve-all',
    sessionKey: 'session-key-1',
    pinned: false,
    adapterConfigJson: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as AgentDefinitionRow
}

describe('harnessRowToCandidate', () => {
  it('maps a claude row to a claude-code provider candidate', () => {
    const candidate = harnessRowToCandidate(makeRow({ id: 'a-1' }))
    expect(candidate).toEqual({
      id: 'harness-claude-a-1',
      type: 'claude-code',
      name: 'Claude Code',
      modelId: 'claude-sonnet-4-6',
      reasoningEffort: 'medium',
      acpAgentId: 'claude',
    })
  })

  it('maps a codex row to a codex provider candidate', () => {
    const candidate = harnessRowToCandidate(
      makeRow({
        id: 'a-2',
        adapter: 'codex',
        modelId: 'gpt-5.5',
        name: 'My Codex',
      }),
    )
    expect(candidate?.type).toBe('codex')
    expect(candidate?.acpAgentId).toBe('codex')
    expect(candidate?.id).toBe('harness-codex-a-2')
    expect(candidate?.name).toBe('My Codex')
  })

  it('returns null for hermes rows (deferred to a follow-up PR)', () => {
    expect(harnessRowToCandidate(makeRow({ adapter: 'hermes' }))).toBeNull()
  })

  it('drops a reasoning effort that is not in the allowed set', () => {
    const candidate = harnessRowToCandidate(
      makeRow({ reasoningEffort: 'xhigh' as never }),
    )
    expect(candidate?.reasoningEffort).toBeUndefined()
  })

  it('preserves "none" / "low" / "high" verbatim', () => {
    expect(
      harnessRowToCandidate(makeRow({ reasoningEffort: 'none' }))
        ?.reasoningEffort,
    ).toBe('none')
    expect(
      harnessRowToCandidate(makeRow({ reasoningEffort: 'high' }))
        ?.reasoningEffort,
    ).toBe('high')
  })
})

describe('buildHarnessProviderCandidates', () => {
  it('preserves input order for in-scope rows', () => {
    const rows = [
      makeRow({ id: 'a-1', adapter: 'codex', modelId: 'gpt-5.5' }),
      makeRow({ id: 'a-2', adapter: 'claude' }),
    ]
    const candidates = buildHarnessProviderCandidates(rows)
    expect(candidates.map((c) => c.id)).toEqual([
      'harness-codex-a-1',
      'harness-claude-a-2',
    ])
  })

  it('silently drops out-of-scope (hermes) rows without affecting position of the rest', () => {
    const rows = [
      makeRow({ id: 'a-1' }),
      makeRow({ id: 'a-2', adapter: 'hermes' }),
      makeRow({ id: 'a-3', adapter: 'codex' }),
    ]
    const candidates = buildHarnessProviderCandidates(rows)
    expect(candidates.map((c) => c.id)).toEqual([
      'harness-claude-a-1',
      'harness-codex-a-3',
    ])
  })

  it('returns an empty array for an empty input', () => {
    expect(buildHarnessProviderCandidates([])).toEqual([])
  })

  it('returns an empty array when every row is out of scope', () => {
    expect(
      buildHarnessProviderCandidates([makeRow({ adapter: 'hermes' })]),
    ).toEqual([])
  })
})
