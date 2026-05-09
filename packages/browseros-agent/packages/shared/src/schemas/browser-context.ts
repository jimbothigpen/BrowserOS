/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared Browser Context Zod schemas - single source of truth.
 * Use z.infer<> for TypeScript types.
 */

import { z } from 'zod'

/**
 * Tab information schema
 */
export const TabSchema: z.ZodObject<{
  id: z.ZodNumber
  url: z.ZodOptional<z.ZodString>
  title: z.ZodOptional<z.ZodString>
  pageId: z.ZodOptional<z.ZodNumber>
}> = z.object({
  id: z.number(),
  url: z.string().optional(),
  title: z.string().optional(),
  pageId: z.number().optional(),
})

export type Tab = z.infer<typeof TabSchema>

/**
 * Custom MCP server configuration schema
 */
export const CustomMcpServerTypeSchema = z.enum(['http', 'process'])

export const CustomMcpServerSchema = z
  .object({
    name: z.string(),
    type: CustomMcpServerTypeSchema.optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string()).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .superRefine((server, ctx) => {
    const type = server.type ?? (server.command ? 'process' : 'http')

    if (type === 'http' && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'HTTP MCP servers require a URL',
      })
    }

    if (type === 'process' && !server.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'Process MCP servers require a command',
      })
    }
  })

export type CustomMcpServer = z.infer<typeof CustomMcpServerSchema>

/**
 * Browser context schema
 * Contains window, tab, and MCP server information for targeting browser operations
 */
export const BrowserContextSchema: z.ZodObject<{
  windowId: z.ZodOptional<z.ZodNumber>
  activeTab: z.ZodOptional<typeof TabSchema>
  selectedTabs: z.ZodOptional<z.ZodArray<typeof TabSchema>>
  tabs: z.ZodOptional<z.ZodArray<typeof TabSchema>>
  enabledMcpServers: z.ZodOptional<z.ZodArray<z.ZodString>>
  customMcpServers: z.ZodOptional<z.ZodArray<typeof CustomMcpServerSchema>>
}> = z.object({
  windowId: z.number().optional(),
  activeTab: TabSchema.optional(),
  selectedTabs: z.array(TabSchema).optional(),
  tabs: z.array(TabSchema).optional(),
  enabledMcpServers: z.array(z.string()).optional(),
  customMcpServers: z.array(CustomMcpServerSchema).optional(),
})

export type BrowserContext = z.infer<typeof BrowserContextSchema>
