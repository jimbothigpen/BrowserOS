/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Production API port for the agent-mcp-interface server.
 *
 * Read by:
 * - src/main.ts when binding the Hono server
 * - src/env.ts as the fallback when no PORT override is set
 * - the future agent-mcp-ui WXT extension when no `?apiUrl=` query is
 *   present (typically packaged builds loading via chrome-extension://)
 *
 * Distinct from @browseros/server (9100) so the two can run side by
 * side. Existing BrowserOS port allocations (per
 * apps/server/.env.example): CDP=9000, server=9100, extension=9300.
 */
export const PROD_API_PORT = 9200
