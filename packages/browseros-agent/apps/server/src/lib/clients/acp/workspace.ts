/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Auto-scratch working directory for ACP chats that have no
 * user-selected workspace and no per-provider default.
 *
 * Most BrowserOS chats are browser tasks where cwd is irrelevant — the
 * agent operates over the BrowserOS MCP, not via filesystem reads.
 * Forcing the user to set a workspace before sending a message would
 * be a bad first-run UX. Each chat gets its own isolated scratch dir
 * keyed by `conversationId`, lazily created on first turn.
 *
 * Path: `~/.browseros/acp-workspaces/<conversationId>/`
 *
 * `conversationId` is validated as a UUID at the request boundary
 * (`ChatRequestSchema.conversationId`), so it cannot contain `..` or
 * `/` — the mkdir is bounded to `~/.browseros/acp-workspaces/`.
 *
 * Cleanup is opt-in for v1; a future enhancement can sweep dirs whose
 * `mtime` is older than 30 days at server start.
 */

import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Override base directory in tests / CI via env var. */
function getAcpWorkspacesRoot(): string {
  return (
    process.env.BROWSEROS_ACP_WORKSPACES_DIR ??
    path.join(os.homedir(), '.browseros', 'acp-workspaces')
  )
}

/**
 * Ensure a per-conversation scratch directory exists and return its
 * absolute path. Synchronous mkdir keeps `createAcpFactory`'s sync
 * dispatch contract; `recursive: true` makes re-creating an existing
 * dir a no-op.
 */
export function ensureAcpScratchDir(conversationId: string): string {
  const dir = path.join(getAcpWorkspacesRoot(), conversationId)
  mkdirSync(dir, { recursive: true })
  return dir
}
