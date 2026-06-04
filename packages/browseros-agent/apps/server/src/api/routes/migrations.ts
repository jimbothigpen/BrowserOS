/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { desc } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../../lib/db'
import { agentDefinitions } from '../../lib/db/schema'
import { logger } from '../../lib/logger'
import { buildHarnessProviderCandidates } from '../services/migrations/buildHarnessProviderCandidates'

/**
 * One-shot migration endpoint. The extension calls it once per fresh
 * install and writes any returned candidates into `local:llm-providers`,
 * gated client-side by a `local:harness-migration-complete` flag so
 * subsequent boots are no-ops. The server itself holds no idempotency
 * state; running this twice just returns the same list.
 */
export function createMigrationsRoutes() {
  return new Hono().get('/llm-providers', async (c) => {
    try {
      const rows = await getDb()
        .select()
        .from(agentDefinitions)
        .orderBy(desc(agentDefinitions.updatedAt))
      const candidates = buildHarnessProviderCandidates(rows)
      return c.json({ candidates })
    } catch (error) {
      logger.warn('Harness-to-providers migration query failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return c.json({ candidates: [] })
    }
  })
}
