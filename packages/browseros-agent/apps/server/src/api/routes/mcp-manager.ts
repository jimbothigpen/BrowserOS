/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import { Hono } from 'hono'
import { getBrowserosDir } from '../../lib/browseros-dir'
import {
  humaniseInstallError,
  installInto,
  listAgents,
  uninstallFrom,
} from '../../lib/mcp-manager'

interface McpManagerRouteOptions {
  /**
   * Returns the BrowserOS MCP URL the running server bound to. Hot
   * because the URL can change between server restarts, so the route
   * reads it per-request rather than caching at module load time.
   */
  getMcpUrl: () => string
  activeHost: string
  activePort: number
}

export function createMcpManagerRoutes(options: McpManagerRouteOptions) {
  const { getMcpUrl, activeHost, activePort } = options

  return new Hono()
    .get('/settings', async (c) => {
      const settingsPath = join(getBrowserosDir(), 'settings.json')
      let savedSettings = {}
      try {
        const fs = await import('node:fs/promises')
        const content = await fs.readFile(settingsPath, 'utf-8')
        savedSettings = JSON.parse(content)
      } catch {
        // settings.json doesn't exist yet
      }
      return c.json({
        activeHost,
        activePort,
        savedSettings,
      })
    })
    .post('/settings', async (c) => {
      try {
        const body = await c.req.json()
        const serverHost = body.serverHost?.trim()
        const serverPort =
          body.serverPort !== undefined ? Number(body.serverPort) : undefined

        if (
          serverHost !== undefined &&
          (typeof serverHost !== 'string' || serverHost.length === 0)
        ) {
          return c.json({ success: false, message: 'Invalid host' }, 400)
        }

        if (
          serverPort !== undefined &&
          (Number.isNaN(serverPort) || serverPort < 1024 || serverPort > 65535)
        ) {
          return c.json({ success: false, message: 'Invalid port' }, 400)
        }

        const settingsPath = join(getBrowserosDir(), 'settings.json')
        let current = {}
        try {
          const fs = await import('node:fs/promises')
          const content = await fs.readFile(settingsPath, 'utf-8')
          current = JSON.parse(content)
        } catch {}

        const next = {
          ...current,
          ...(serverHost !== undefined ? { serverHost } : {}),
          ...(serverPort !== undefined ? { serverPort } : {}),
        }

        const fs = await import('node:fs/promises')
        await fs.writeFile(settingsPath, JSON.stringify(next, null, 2))

        return c.json({ success: true })
      } catch (err) {
        return c.json(
          {
            success: false,
            message: err instanceof Error ? err.message : String(err),
          },
          500,
        )
      }
    })
    .get('/agents', async (c) => {
      try {
        const agents = await listAgents()
        return c.json({ agents })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ message }, 500)
      }
    })
    .post('/agents/:id/install', async (c) => {
      const id = c.req.param('id')
      try {
        const result = await installInto(id, getMcpUrl())
        return c.json(result, 200)
      } catch (err) {
        const { message, status } = humaniseInstallError(err)
        return c.json(
          { success: false, message },
          status as 400 | 404 | 409 | 500,
        )
      }
    })
    .post('/agents/:id/uninstall', async (c) => {
      const id = c.req.param('id')
      try {
        const result = await uninstallFrom(id)
        return c.json(result, result.success ? 200 : 409)
      } catch (err) {
        const { message, status } = humaniseInstallError(err)
        return c.json(
          { success: false, message },
          status as 400 | 404 | 409 | 500,
        )
      }
    })
}
