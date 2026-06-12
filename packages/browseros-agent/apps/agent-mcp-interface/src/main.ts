#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Bun entry point for the agent-mcp-interface server.
 *
 * Binds Hono on 127.0.0.1 — same posture as @browseros/server. The
 * loopback restriction is what lets us run with wildcard CORS and
 * accept `null` Origin requests from the future WXT extension
 * loading via chrome-extension://. No external network reachability.
 *
 * The agent-mcp-ui extension reads PROD_API_PORT off the shared port
 * constant; in dev it can pick up an `?apiUrl=` override published
 * by whichever launcher started this process.
 */

if (typeof Bun === 'undefined') {
  // biome-ignore lint/suspicious/noConsole: pre-logger bootstrap notice
  console.error(
    'agent-mcp-interface requires the Bun runtime. Install Bun (https://bun.sh) and re-run with `bun src/main.ts`.',
  )
  process.exit(1)
}

import { env } from './env'
import { logger } from './lib/logger'
import { setLocalServerUrl } from './local-server-url'
import server from './server'

function start(): void {
  const httpServer = Bun.serve({
    hostname: '127.0.0.1',
    port: env.port,
    fetch: server.fetch,
  })
  const url = `http://${httpServer.hostname}:${httpServer.port}`
  setLocalServerUrl(url)
  logger.info('agent-mcp-interface listening', { url })
}

start()
