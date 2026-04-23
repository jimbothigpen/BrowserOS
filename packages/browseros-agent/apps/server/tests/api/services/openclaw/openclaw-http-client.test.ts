/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  OpenClawHttpClient,
  type OpenClawSessionHistory,
  OpenClawSessionNotFoundError,
  type OpenClawSessionSummary,
} from '../../../../src/api/services/openclaw/openclaw-http-client'

describe('OpenClawHttpClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('probes the loopback gateway without authorization headers', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const signal = new AbortController().signal
    const client = new OpenClawHttpClient(18789)

    await client.probe(signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18789/v1/models',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      signal,
    })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined()
  })

  it('surfaces gateway probe failures with response details', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('gateway unavailable', { status: 503 })),
    ) as typeof globalThis.fetch
    const client = new OpenClawHttpClient(18789)

    await expect(client.probe()).rejects.toThrow('gateway unavailable')
  })

  it('maps top-level agent arrays into BrowserOS agent records', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          result: [
            {
              id: 'research',
              name: 'Research',
              workspace: '/workspace/research',
              model: 'openclaw/research',
            },
            {
              id: 'ops',
            },
          ],
        }),
      ),
    )
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const signal = new AbortController().signal
    const client = new OpenClawHttpClient(18789)

    await expect(client.listAgents(signal)).resolves.toEqual([
      {
        agentId: 'research',
        name: 'Research',
        workspace: '/workspace/research',
        model: 'openclaw/research',
      },
      {
        agentId: 'ops',
        name: 'ops',
        workspace: '',
        model: undefined,
      },
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18789/tools/invoke',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      tool: 'agents_list',
      args: {},
    })
  })

  it('accepts wrapped agents_list payloads', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          result: {
            agents: [{ id: 'main', workspace: '/workspace/main' }],
          },
        }),
      ),
    ) as typeof globalThis.fetch
    const client = new OpenClawHttpClient(18789)

    await expect(client.listAgents()).resolves.toEqual([
      {
        agentId: 'main',
        name: 'main',
        workspace: '/workspace/main',
        model: undefined,
      },
    ])
  })

  it('surfaces tool error payloads and non-2xx failures from listAgents', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          ok: false,
          error: { message: 'agent list denied' },
        }),
      ),
    ) as typeof globalThis.fetch
    const client = new OpenClawHttpClient(18789)

    await expect(client.listAgents()).rejects.toThrow('agent list denied')

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('gateway exploded', { status: 500 })),
    ) as typeof globalThis.fetch

    await expect(client.listAgents()).rejects.toThrow('gateway exploded')
  })

  it('forwards only defined session-list filters and returns the raw tool payload', async () => {
    const sessions: OpenClawSessionSummary[] = [
      {
        key: 'session-1',
        agentId: 'research',
        kind: 'chat',
        updatedAt: 123,
        messageCount: 4,
      },
    ]
    const fetchMock = mock(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          result: sessions,
        }),
      ),
    )
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const signal = new AbortController().signal
    const client = new OpenClawHttpClient(18789)

    await expect(
      client.listSessions({
        limit: 25,
        activeMinutes: 10,
        kinds: ['chat'],
        signal,
      }),
    ).resolves.toEqual(sessions)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18789/tools/invoke',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      tool: 'sessions_list',
      args: {
        limit: 25,
        activeMinutes: 10,
        kinds: ['chat'],
      },
    })
  })

  it('fetches session history over loopback with encoded keys and optional query params', async () => {
    const history: OpenClawSessionHistory = {
      sessionKey: 'agent:main:cafe/1',
      messages: [{ role: 'assistant', content: 'Ready' }],
      cursor: 'cursor-2',
      hasMore: true,
    }
    const fetchMock = mock(() => Promise.resolve(Response.json(history)))
    globalThis.fetch = fetchMock as typeof globalThis.fetch
    const signal = new AbortController().signal
    const client = new OpenClawHttpClient(18789)

    await expect(
      client.getSessionHistory('agent:main:cafe/1', {
        limit: 25,
        cursor: 'cursor two',
        signal,
      }),
    ).resolves.toEqual(history)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:18789/sessions/agent%3Amain%3Acafe%2F1/history?limit=25&cursor=cursor+two',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      signal,
    })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined()
  })

  it('maps missing session history to a typed not-found error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as typeof globalThis.fetch
    const client = new OpenClawHttpClient(18789)

    await expect(
      client.getSessionHistory('missing-session'),
    ).rejects.toBeInstanceOf(OpenClawSessionNotFoundError)
  })

  it('surfaces structured history endpoint errors', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json(
          { error: { message: 'history backend unavailable' } },
          { status: 503 },
        ),
      ),
    ) as typeof globalThis.fetch
    const client = new OpenClawHttpClient(18789)

    await expect(client.getSessionHistory('session-1')).rejects.toThrow(
      'history backend unavailable',
    )
  })
})
