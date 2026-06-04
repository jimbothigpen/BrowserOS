import { getAgentServerUrl } from '@/lib/browseros/helpers'
import type { LlmProviderConfig } from './types'

/**
 * Wire shape of the `/migrations/llm-providers` endpoint payload. The
 * server-side type lives in
 * `apps/server/src/api/services/migrations/buildHarnessProviderCandidates.ts`.
 */
interface HarnessProviderCandidate {
  id: string
  type: 'claude-code' | 'codex'
  name: string
  modelId: string
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  acpAgentId: 'claude' | 'codex'
}

interface MigrationResponse {
  candidates: HarnessProviderCandidate[]
}

const CLAUDE_CONTEXT_WINDOW = 200000
const CODEX_CONTEXT_WINDOW = 400000

function homeDirFromEnv(): string {
  // The renderer lives in an extension, so we cannot read $HOME directly.
  // The server only needs to know about the path when it spawns the
  // ACP process; on the renderer side we just stash a placeholder
  // path that uses the literal "$HOME" token. The chat path resolves
  // it at spawn time. If the user later edits the provider record we
  // overwrite the path with whatever they pick.
  return '$HOME/browseros-workspaces'
}

function candidateToProvider(
  candidate: HarnessProviderCandidate,
  now: number,
): LlmProviderConfig {
  const contextWindow =
    candidate.type === 'codex' ? CODEX_CONTEXT_WINDOW : CLAUDE_CONTEXT_WINDOW
  return {
    id: candidate.id,
    type: candidate.type,
    name: candidate.name,
    modelId: candidate.modelId,
    supportsImages: true,
    contextWindow,
    temperature: 0.7,
    createdAt: now,
    updatedAt: now,
    reasoningEffort: candidate.reasoningEffort,
    acpAgentId: candidate.acpAgentId,
    acpFixedWorkspacePath: `${homeDirFromEnv()}/${candidate.id}`,
  }
}

export interface ImportHarnessProvidersResult {
  /** Provider records added in this pass (already deduped against `existing`). */
  added: LlmProviderConfig[]
  /** Candidates that matched an existing id and were skipped. */
  skipped: number
  /** Whether the endpoint returned at least one candidate. */
  hadCandidates: boolean
}

/**
 * Fetch the migration candidates and fold them into the provider list
 * passed in. Pure function; the caller decides whether to persist.
 * Returns the original list untouched when there are zero new entries.
 */
export async function importHarnessProviders(
  existing: ReadonlyArray<LlmProviderConfig>,
  options?: { now?: () => number; fetchImpl?: typeof fetch },
): Promise<ImportHarnessProvidersResult> {
  const now = options?.now ?? Date.now
  const fetchImpl = options?.fetchImpl ?? fetch
  const serverUrl = await getAgentServerUrl()
  const response = await fetchImpl(`${serverUrl}/migrations/llm-providers`)
  if (!response.ok) {
    return { added: [], skipped: 0, hadCandidates: false }
  }
  const payload = (await response.json()) as MigrationResponse
  const candidates = payload?.candidates ?? []
  if (candidates.length === 0) {
    return { added: [], skipped: 0, hadCandidates: false }
  }
  const existingIds = new Set(existing.map((p) => p.id))
  const added: LlmProviderConfig[] = []
  let skipped = 0
  const nowValue = now()
  for (const candidate of candidates) {
    if (existingIds.has(candidate.id)) {
      skipped += 1
      continue
    }
    added.push(candidateToProvider(candidate, nowValue))
  }
  return { added, skipped, hadCandidates: true }
}
