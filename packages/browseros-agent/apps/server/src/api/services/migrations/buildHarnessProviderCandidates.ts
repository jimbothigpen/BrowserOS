/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { AgentDefinitionRow } from '../../../lib/db/schema/agents'

/**
 * Public migration payload returned by `GET /migrations/llm-providers`.
 * The extension imports each candidate as an `LlmProviderConfig`
 * (matching the additive ACP fields landed earlier on this branch).
 */
export interface HarnessProviderCandidate {
  /**
   * Stable id derived from the harness row id. The extension uses this
   * for dedupe so re-running the migration after a partial import or a
   * storage reset never produces duplicates.
   */
  id: string
  /** Provider type the extension should write. */
  type: 'claude-code' | 'codex'
  /** Display name. Sourced from the harness row's `name` column. */
  name: string
  /** Model id stored on the harness row. */
  modelId: string
  /** Reasoning effort stored on the harness row, normalized. */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  /** Agent id passed to acpx's registry. Matches the harness adapter. */
  acpAgentId: 'claude' | 'codex'
}

const ADAPTER_TO_PROVIDER_TYPE: Record<
  string,
  HarnessProviderCandidate['type'] | null
> = {
  claude: 'claude-code',
  codex: 'codex',
  // Hermes harness rows are intentionally not migrated in this PR.
  // They come back as a vanilla ACP-registry override (`hermes acp`)
  // in a follow-up PR; until then the extension shouldn't grow a
  // dangling 'hermes' provider entry that points at nothing.
  hermes: null,
}

const ALLOWED_REASONING = new Set(['none', 'low', 'medium', 'high'])

function normalizeReasoningEffort(
  raw: string,
): HarnessProviderCandidate['reasoningEffort'] {
  return ALLOWED_REASONING.has(raw)
    ? (raw as HarnessProviderCandidate['reasoningEffort'])
    : undefined
}

/**
 * Translate a harness row into a provider candidate, or null if the
 * adapter is not currently in scope (Hermes).
 */
export function harnessRowToCandidate(
  row: AgentDefinitionRow,
): HarnessProviderCandidate | null {
  const type = ADAPTER_TO_PROVIDER_TYPE[row.adapter]
  if (!type) return null
  const acpAgentId = row.adapter === 'codex' ? 'codex' : 'claude'
  return {
    id: `harness-${row.adapter}-${row.id}`,
    type,
    name: row.name,
    modelId: row.modelId,
    reasoningEffort: normalizeReasoningEffort(row.reasoningEffort),
    acpAgentId,
  }
}

/**
 * Bulk-translate harness rows. The order is preserved for stable
 * client-side rendering; in-scope rows pass through, out-of-scope rows
 * are silently dropped.
 */
export function buildHarnessProviderCandidates(
  rows: ReadonlyArray<AgentDefinitionRow>,
): HarnessProviderCandidate[] {
  const out: HarnessProviderCandidate[] = []
  for (const row of rows) {
    const candidate = harnessRowToCandidate(row)
    if (candidate) out.push(candidate)
  }
  return out
}
