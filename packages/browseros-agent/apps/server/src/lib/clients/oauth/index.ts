/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Database } from 'bun:sqlite'
import { startOAuthCallbackServer } from './callback-server'
import { OAuthTokenManager } from './token-manager'
import { OAuthTokenStore } from './token-store'

let tokenManager: OAuthTokenManager | null = null

interface OAuthHandle {
  tokenManager: OAuthTokenManager
  stopCallbackServer: () => void
}

export function initializeOAuth(
  db: Database,
  browserosId: string,
): OAuthHandle {
  const store = new OAuthTokenStore(db)
  tokenManager = new OAuthTokenManager(store, browserosId)
  const { stop } = startOAuthCallbackServer(tokenManager)
  return { tokenManager, stopCallbackServer: stop }
}

export function getOAuthTokenManager(): OAuthTokenManager | null {
  return tokenManager
}
