/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { AgentHarnessService } from '../../../../src/api/services/agents/agent-harness-service'
import type {
  AgentDefinition,
  AgentTranscriptEntry,
} from '../../../../src/lib/agents/agent-types'
import type { FileAgentStore } from '../../../../src/lib/agents/file-agent-store'
import type { FileTranscriptStore } from '../../../../src/lib/agents/file-transcript-store'
import type {
  AgentRuntime,
  AgentStreamEvent,
} from '../../../../src/lib/agents/types'

describe('AgentHarnessService', () => {
  it('creates named agents and sends prompts through the main session', async () => {
    const agents: AgentDefinition[] = []
    const transcripts: AgentTranscriptEntry[] = []
    const runtimeInputs: unknown[] = []
    const agentStore = {
      async list() {
        return agents
      },
      async get(id: string) {
        return agents.find((agent) => agent.id === id) ?? null
      },
      async create(input) {
        const agent: AgentDefinition = {
          id: 'agent-1',
          name: input.name,
          adapter: input.adapter,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          permissionMode: 'approve-all',
          sessionKey: 'agent:agent-1:main',
          createdAt: 1000,
          updatedAt: 1000,
        }
        agents.push(agent)
        return agent
      },
      async delete() {
        return true
      },
    } satisfies Partial<FileAgentStore>
    const transcriptStore = {
      async append(input) {
        const entry: AgentTranscriptEntry = {
          id: String(transcripts.length + 1),
          createdAt: 1000 + transcripts.length,
          ...input,
        }
        transcripts.push(entry)
        return entry
      },
      async list() {
        return transcripts
      },
    } satisfies Partial<FileTranscriptStore>
    const runtime: AgentRuntime = {
      async status() {
        return { state: 'ready' }
      },
      async listSessions() {
        return []
      },
      async getHistory() {
        return { agentId: 'agent-1', sessionId: 'main', items: [] }
      },
      async send(input) {
        runtimeInputs.push(input)
        return new ReadableStream<AgentStreamEvent>({
          start(controller) {
            controller.enqueue({
              type: 'text_delta',
              text: 'answer',
              stream: 'output',
            })
            controller.enqueue({ type: 'done', stopReason: 'end_turn' })
            controller.close()
          },
        })
      },
    }

    const service = new AgentHarnessService({
      agentStore: agentStore as FileAgentStore,
      transcriptStore: transcriptStore as FileTranscriptStore,
      runtime,
    })

    const agent = await service.createAgent({
      name: 'Review bot',
      adapter: 'codex',
      modelId: 'gpt-5.5',
      reasoningEffort: 'medium',
    })
    const stream = await service.send({
      agentId: agent.id,
      message: 'hello',
    })
    await stream.pipeTo(new WritableStream())

    expect(runtimeInputs[0]).toMatchObject({
      agent,
      sessionId: 'main',
      sessionKey: 'agent:agent-1:main',
      message: 'hello',
      permissionMode: 'approve-all',
    })
    expect(transcripts.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'answer' },
    ])
  })

  it('flushes partial assistant text when the response stream is cancelled', async () => {
    const agent: AgentDefinition = {
      id: 'agent-1',
      name: 'Review bot',
      adapter: 'codex',
      modelId: 'gpt-5.5',
      reasoningEffort: 'medium',
      permissionMode: 'approve-all',
      sessionKey: 'agent:agent-1:main',
      createdAt: 1000,
      updatedAt: 1000,
    }
    const transcripts: AgentTranscriptEntry[] = []
    const agentStore = {
      async list() {
        return [agent]
      },
      async get(id: string) {
        return id === agent.id ? agent : null
      },
      async create() {
        return agent
      },
      async delete() {
        return true
      },
    } satisfies Partial<FileAgentStore>
    const transcriptStore = {
      async append(input) {
        const entry: AgentTranscriptEntry = {
          id: String(transcripts.length + 1),
          createdAt: 1000 + transcripts.length,
          ...input,
        }
        transcripts.push(entry)
        return entry
      },
      async list() {
        return transcripts
      },
    } satisfies Partial<FileTranscriptStore>
    const runtime: AgentRuntime = {
      async status() {
        return { state: 'ready' }
      },
      async listSessions() {
        return []
      },
      async getHistory() {
        return { agentId: agent.id, sessionId: 'main', items: [] }
      },
      async send() {
        return new ReadableStream<AgentStreamEvent>({
          start(controller) {
            controller.enqueue({
              type: 'text_delta',
              text: 'partial answer',
              stream: 'output',
            })
          },
        })
      },
    }
    const service = new AgentHarnessService({
      agentStore: agentStore as FileAgentStore,
      transcriptStore: transcriptStore as FileTranscriptStore,
      runtime,
    })

    const reader = (
      await service.send({
        agentId: agent.id,
        message: 'hello',
      })
    ).getReader()
    await reader.read()
    await reader.cancel()

    expect(transcripts.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'partial answer' },
    ])
  })
})
