/**
 * @license
 * Copyright 2025 BrowserOS
 */

import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import type {
  BrowserOsAgentCatalogEntry,
  BrowserOsAgentChatInput,
  BrowserOsAgentCreateInput,
} from '../services/agents/adapters/types'
import { getBrowserOsAgentService } from '../services/agents/agent-service'
import {
  formatUIMessageStreamDone,
  formatUIMessageStreamEvent,
} from '../utils/ui-message-stream'

interface BrowserOsAgentRoutesService {
  catalog(): BrowserOsAgentCatalogEntry[]
  list(): Promise<unknown>
  create(input: BrowserOsAgentCreateInput): Promise<unknown>
  remove(agentId: string): Promise<void>
  chat(
    agentId: string,
    input: BrowserOsAgentChatInput,
  ): Promise<ReadableStream<UIMessageStreamEvent>>
}

const CreateAgentRequestSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    adapterType: z.enum(['openclaw', 'codex_local', 'claude_local']),
    binaryPath: z.string().optional(),
    providerType: z.string().optional(),
    providerName: z.string().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    modelId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.adapterType === 'codex_local' ||
        value.adapterType === 'claude_local') &&
      !value.binaryPath?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['binaryPath'],
        message: 'binaryPath is required for local adapters',
      })
    }
  })

const ChatAgentRequestSchema = z.object({
  message: z.string().trim().min(1),
  sessionKey: z.string().trim().min(1).optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().trim().min(1),
      }),
    )
    .optional(),
})

export function createAgentsRoutes(
  service: BrowserOsAgentRoutesService = getBrowserOsAgentService(),
) {
  return new Hono()
    .get('/catalog', async (c) => c.json({ adapters: service.catalog() }))
    .get('/', async (c) => {
      try {
        return c.json({ agents: await service.list() })
      } catch (error) {
        return c.json({ error: toErrorMessage(error) }, 500)
      }
    })
    .post(
      '/',
      zValidator('json', CreateAgentRequestSchema, validationErrorResponse),
      async (c) => {
        const body = c.req.valid('json')
        try {
          const agent = await service.create(body as BrowserOsAgentCreateInput)
          return c.json({ agent }, 201)
        } catch (error) {
          return c.json(
            { error: toErrorMessage(error) },
            toErrorStatusCode(error),
          )
        }
      },
    )
    .delete('/:id', async (c) => {
      try {
        await service.remove(c.req.param('id'))
        return c.json({ success: true })
      } catch (error) {
        return c.json(
          { error: toErrorMessage(error) },
          toErrorStatusCode(error),
        )
      }
    })
    .post(
      '/:id/chat',
      zValidator('json', ChatAgentRequestSchema, validationErrorResponse),
      async (c) => {
        const body = c.req.valid('json')
        const sessionKey = body.sessionKey || crypto.randomUUID()
        try {
          const eventStream = await service.chat(c.req.param('id'), {
            sessionKey,
            message: body.message,
            conversation: normalizeConversation(body.conversation),
          })
          c.header('Content-Type', 'text/event-stream')
          c.header('Cache-Control', 'no-cache')
          c.header('X-Session-Key', sessionKey)
          c.header('x-vercel-ai-ui-message-stream', 'v1')
          return stream(c, async (honoStream) => {
            const reader = eventStream.getReader()
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  break
                }
                await honoStream.write(formatUIMessageStreamEvent(value))
              }
            } finally {
              reader.releaseLock()
            }
            await honoStream.write(formatUIMessageStreamDone())
          })
        } catch (error) {
          return c.json(
            { error: toErrorMessage(error) },
            toErrorStatusCode(error),
          )
        }
      },
    )
}

function normalizeConversation(
  conversation: BrowserOsAgentChatInput['conversation'],
): BrowserOsAgentChatInput['conversation'] {
  if (!Array.isArray(conversation)) {
    return undefined
  }
  return conversation
    .filter(
      (
        entry,
      ): entry is NonNullable<
        BrowserOsAgentChatInput['conversation']
      >[number] =>
        !!entry &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.text === 'string' &&
        entry.text.trim().length > 0,
    )
    .map((entry) => ({
      role: entry.role,
      text: entry.text,
    }))
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toErrorStatusCode(error: unknown): 400 | 404 | 409 | 500 {
  const message = toErrorMessage(error)
  if (/not found/i.test(message)) {
    return 404
  }
  if (/already exists/i.test(message)) {
    return 409
  }
  if (isBadRequestMessage(message)) {
    return 400
  }
  return 500
}

function isBadRequestMessage(message: string): boolean {
  return [
    /requires/i,
    /must be running/i,
    /invalid/i,
    /hello probe failed/i,
    /unsupported openclaw provider/i,
  ].some((pattern) => pattern.test(message))
}

function validationErrorResponse(result: { success: boolean }, c: Context) {
  if (!result.success) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  return undefined
}
