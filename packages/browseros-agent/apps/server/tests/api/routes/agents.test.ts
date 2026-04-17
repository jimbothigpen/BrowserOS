/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import { Hono } from 'hono'
import { requireTrustedAppOrigin } from '../../../src/api/utils/request-auth'

describe('createAgentsRoutes', () => {
  it('serves catalog, list, create, delete, and SSE chat through the generic agent service', async () => {
    const catalog = mock(() => [
      { adapterType: 'openclaw', label: 'OpenClaw' },
      { adapterType: 'codex_local', label: 'Codex Local' },
    ])
    const list = mock(async () => [createStoredAgent()])
    const create = mock(async () => createStoredAgent())
    const remove = mock(async () => {})
    const chat = mock(async (_agentId: string, _input: unknown) =>
      createEventStream([
        { type: 'start' },
        { type: 'text-start', id: 'agent-text' },
        { type: 'text-delta', id: 'agent-text', delta: 'Hello' },
        { type: 'text-end', id: 'agent-text' },
        { type: 'finish', finishReason: 'stop' },
      ]),
    )

    const { createAgentsRoutes } = await import(
      '../../../src/api/routes/agents'
    )
    const route = createAgentsRoutes({
      catalog,
      list,
      create,
      remove,
      chat,
    } as never)

    const catalogResponse = await route.request('/catalog')
    expect(catalogResponse.status).toBe(200)
    expect(await catalogResponse.json()).toEqual({
      adapters: [
        { adapterType: 'openclaw', label: 'OpenClaw' },
        { adapterType: 'codex_local', label: 'Codex Local' },
      ],
    })

    const listResponse = await route.request('/')
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({
      agents: [createStoredAgent()],
    })

    const createResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'codex_local',
        binaryPath: '/usr/local/bin/codex',
      }),
    })
    expect(createResponse.status).toBe(201)
    expect(await createResponse.json()).toEqual({
      agent: createStoredAgent(),
    })
    expect(create).toHaveBeenCalledWith({
      id: 'agent',
      name: 'Agent',
      adapterType: 'codex_local',
      binaryPath: '/usr/local/bin/codex',
    })

    const deleteResponse = await route.request('/agent', {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({ success: true })
    expect(remove).toHaveBeenCalledWith('agent')

    const chatResponse = await route.request('/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Summarize it.',
        sessionKey: 'session-123',
        conversation: [
          { role: 'user', text: 'What happened?' },
          { role: 'assistant', text: 'We shipped Task 5.' },
        ],
      }),
    })

    expect(chatResponse.status).toBe(200)
    expect(chatResponse.headers.get('Content-Type')).toContain(
      'text/event-stream',
    )
    expect(chatResponse.headers.get('X-Session-Key')).toBe('session-123')
    expect(chat).toHaveBeenCalledWith('agent', {
      sessionKey: 'session-123',
      message: 'Summarize it.',
      conversation: [
        { role: 'user', text: 'What happened?' },
        { role: 'assistant', text: 'We shipped Task 5.' },
      ],
    })
    expect(await chatResponse.text()).toBe(
      'data: {"type":"start"}\n\n' +
        'data: {"type":"text-start","id":"agent-text"}\n\n' +
        'data: {"type":"text-delta","id":"agent-text","delta":"Hello"}\n\n' +
        'data: {"type":"text-end","id":"agent-text"}\n\n' +
        'data: {"type":"finish","finishReason":"stop"}\n\n' +
        'data: [DONE]\n\n',
    )
  })

  it('returns 400 for malformed JSON and invalid payloads on create and chat', async () => {
    const { createAgentsRoutes } = await import(
      '../../../src/api/routes/agents'
    )
    const route = createAgentsRoutes({
      catalog: mock(() => []),
      list: mock(async () => []),
      create: mock(async () => createStoredAgent()),
      remove: mock(async () => {}),
      chat: mock(async () => createEventStream([])),
    } as never)

    const createResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":',
    })
    expect(createResponse.status).toBe(400)

    const invalidCreateResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '',
        name: 'Agent',
        adapterType: 'codex_local',
      }),
    })
    expect(invalidCreateResponse.status).toBe(400)

    const invalidRoleIdResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'openclaw',
        roleId: 'not-a-real-role',
      }),
    })
    expect(invalidRoleIdResponse.status).toBe(400)

    const invalidCustomRoleResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'openclaw',
        customRole: {
          name: 'Ops',
          shortDescription: 'Runs ops',
          recommendedApps: ['slack'],
          boundaries: [{ key: 'send', defaultMode: 'ask' }],
        },
      }),
    })
    expect(invalidCustomRoleResponse.status).toBe(400)

    const mixedRoleResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'openclaw',
        roleId: 'chief-of-staff',
        customRole: {
          name: 'Ops',
          shortDescription: 'Runs ops',
          longDescription: 'Runs ops across BrowserOS.',
          recommendedApps: ['slack'],
          boundaries: [
            {
              key: 'send',
              label: 'Send',
              description: 'Send messages',
              defaultMode: 'ask',
            },
          ],
        },
      }),
    })
    expect(mixedRoleResponse.status).toBe(400)

    const chatResponse = await route.request('/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"message":',
    })
    expect(chatResponse.status).toBe(400)

    const invalidChatResponse = await route.request('/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '',
      }),
    })
    expect(invalidChatResponse.status).toBe(400)
  })

  it('returns 404/409 for known user-facing service errors', async () => {
    const { createAgentsRoutes } = await import(
      '../../../src/api/routes/agents'
    )
    const route = createAgentsRoutes({
      catalog: mock(() => []),
      list: mock(async () => []),
      create: mock(async () => {
        throw new Error('Agent "agent" already exists')
      }),
      remove: mock(async () => {
        throw new Error('Agent "missing" not found')
      }),
      chat: mock(async () => {
        throw new Error('Agent "missing" not found')
      }),
    } as never)

    const createResponse = await route.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'codex_local',
      }),
    })
    expect(createResponse.status).toBe(409)

    const deleteResponse = await route.request('/missing', {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(404)

    const chatResponse = await route.request('/missing/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
      }),
    })
    expect(chatResponse.status).toBe(404)
  })

  it('can be mounted behind trusted-origin protection for agent control routes', async () => {
    const { createAgentsRoutes } = await import(
      '../../../src/api/routes/agents'
    )
    const app = new Hono().use('/*', requireTrustedAppOrigin()).route(
      '/agents',
      createAgentsRoutes({
        catalog: mock(() => []),
        list: mock(async () => []),
        create: mock(async () => createStoredAgent()),
        remove: mock(async () => {}),
        chat: mock(async () => createEventStream([])),
      } as never),
    )

    const forbidden = await app.request('http://localhost/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({
        id: 'agent',
        name: 'Agent',
        adapterType: 'codex_local',
      }),
    })
    expect(forbidden.status).toBe(403)

    const allowed = await app.request('http://localhost/agents/catalog', {
      headers: { Origin: 'chrome-extension://browseros' },
    })
    expect(allowed.status).toBe(200)
  })
})

function createStoredAgent(): BrowserOsStoredAgent {
  return {
    version: 1,
    id: 'agent',
    name: 'Agent',
    adapterType: 'codex_local',
    role: {
      roleSource: 'builtin',
      roleId: 'chief-of-staff',
      roleName: 'Chief of Staff',
      shortDescription: 'Coordinates work.',
    },
    paths: {
      agentDir: '/tmp/agent',
      cwd: '/tmp/agent',
      contextDirs: [],
    },
    adapterConfig: {
      binaryPath: '/usr/local/bin/codex',
    },
    runtimeBinding: null,
    lastValidation: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function createEventStream(
  events: UIMessageStreamEvent[],
): ReadableStream<UIMessageStreamEvent> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event)
      }
      controller.close()
    },
  })
}
