/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { AGENT_HARNESS_LIMITS } from '@browseros/shared/constants/limits'
import { Hono } from 'hono'
import { createAgentRoutes } from '../../../src/api/routes/agents'
import type { AgentDefinition } from '../../../src/lib/agents/agent-types'
import type { AgentStreamEvent } from '../../../src/lib/agents/types'

describe('createAgentRoutes', () => {
  it('creates and lists harness agents', async () => {
    const agents: AgentDefinition[] = []
    const route = createMountedRoutes(agents)
    const created = await route.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Review bot',
        adapter: 'codex',
        modelId: 'gpt-5.5',
        reasoningEffort: 'medium',
      }),
    })

    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({
      agent: { name: 'Review bot', adapter: 'codex' },
    })

    const list = await route.request('/agents')
    expect(await list.json()).toMatchObject({
      agents: [{ name: 'Review bot', adapter: 'codex' }],
    })
  })

  it('streams chat for an agent main session', async () => {
    const route = createMountedRoutes([
      {
        id: 'agent-1',
        name: 'Review bot',
        adapter: 'codex',
        modelId: 'gpt-5.5',
        reasoningEffort: 'medium',
        permissionMode: 'approve-all',
        sessionKey: 'agent:agent-1:main',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ])

    const response = await route.request('/agents/agent-1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Session-Id')).toBe('main')
    expect(await response.text()).toContain('data: [DONE]')
  })

  it('rejects overlong agent names', async () => {
    const route = createMountedRoutes([])
    const response = await route.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'a'.repeat(AGENT_HARNESS_LIMITS.AGENT_NAME_MAX_CHARS + 1),
        adapter: 'codex',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: `Name must be ${AGENT_HARNESS_LIMITS.AGENT_NAME_MAX_CHARS} characters or fewer`,
    })
  })
})

function createMountedRoutes(agents: AgentDefinition[]) {
  return new Hono().route(
    '/agents',
    createAgentRoutes({ service: createFakeService(agents) }),
  )
}

function createFakeService(agents: AgentDefinition[]) {
  return {
    async listAgents() {
      return agents
    },
    async createAgent(input: {
      name: string
      adapter: 'claude' | 'codex'
      modelId?: string
      reasoningEffort?: string
    }) {
      const agent: AgentDefinition = {
        id: `agent-${agents.length + 1}`,
        name: input.name,
        adapter: input.adapter,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
        permissionMode: 'approve-all',
        sessionKey: `agent:agent-${agents.length + 1}:main`,
        createdAt: 1000,
        updatedAt: 1000,
      }
      agents.push(agent)
      return agent
    },
    async getAgent(agentId: string) {
      return agents.find((agent) => agent.id === agentId) ?? null
    },
    async deleteAgent(agentId: string) {
      const index = agents.findIndex((agent) => agent.id === agentId)
      if (index < 0) return false
      agents.splice(index, 1)
      return true
    },
    async getHistory(agentId: string) {
      return {
        agentId,
        sessionId: 'main' as const,
        items: [],
      }
    },
    async send() {
      return new ReadableStream<AgentStreamEvent>({
        start(controller) {
          controller.enqueue({
            type: 'text_delta',
            text: 'Hello',
            stream: 'output',
          })
          controller.enqueue({ type: 'done', stopReason: 'end_turn' })
          controller.close()
        },
      })
    },
  }
}
