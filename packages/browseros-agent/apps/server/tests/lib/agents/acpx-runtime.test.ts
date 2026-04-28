/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
  AcpRuntime as AcpxCoreRuntime,
} from 'acpx/runtime'
import { AcpxRuntime } from '../../../src/lib/agents/acpx-runtime'
import type { AgentDefinition } from '../../../src/lib/agents/agent-types'
import type { AgentStreamEvent } from '../../../src/lib/agents/types'

describe('AcpxRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  it('uses acpx/runtime to ensure a session and stream a turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'browseros-acpx-runtime-'))
    const stateDir = await mkdtemp(join(tmpdir(), 'browseros-acpx-state-'))
    tempDirs.push(cwd, stateDir)
    const calls: Array<{ method: string; input: unknown }> = []
    const runtimeFactory = (options: AcpRuntimeOptions): AcpxCoreRuntime => {
      calls.push({ method: 'createRuntime', input: options })
      return createFakeAcpRuntime(calls)
    }

    const runtime = new AcpxRuntime({ cwd, stateDir, runtimeFactory })
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
    const stream = await runtime.send({
      agent,
      sessionId: 'main',
      sessionKey: agent.sessionKey,
      message: 'say hello',
      permissionMode: 'approve-all',
    })

    const events = await collectStream(stream)

    expect(calls.map((call) => call.method)).toEqual([
      'createRuntime',
      'ensureSession',
      'setConfigOption',
      'startTurn',
    ])
    expect(calls[0]?.input).toMatchObject({
      cwd,
      permissionMode: 'approve-all',
      nonInteractivePermissions: 'fail',
    })
    expect(calls[1]?.input).toEqual({
      sessionKey: 'agent:agent-1:main',
      agent: 'codex',
      mode: 'persistent',
      cwd,
    })
    expect(calls[2]?.input).toMatchObject({
      key: 'reasoning_effort',
      value: 'medium',
    })
    expect(calls[3]?.input).toMatchObject({
      text: 'say hello',
      mode: 'prompt',
    })
    expect(events).toEqual([
      {
        type: 'status',
        text: 'Requested model is stored on the BrowserOS agent, but this acpx/runtime version does not expose public model control. Using adapter default.',
      },
      {
        type: 'text_delta',
        text: 'Hello from fake runtime',
        stream: 'output',
        rawType: 'agent_message_chunk',
      },
      {
        type: 'tool_call',
        text: 'Run tests (completed)',
        title: 'Run tests',
        id: 'tool-1',
        status: 'completed',
        rawType: 'tool_call_update',
      },
      {
        type: 'done',
        stopReason: 'end_turn',
      },
    ])
  })

  it('continues the turn when runtime config control is unavailable', async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const runtime = new AcpxRuntime({
      cwd: '/tmp/browseros-acpx-runtime',
      stateDir: '/tmp/browseros-acpx-state',
      runtimeFactory: () => createFakeAcpRuntime(calls, { failConfig: true }),
    })
    const agent: AgentDefinition = {
      id: 'agent-1',
      name: 'Claude bot',
      adapter: 'claude',
      modelId: 'haiku',
      reasoningEffort: 'medium',
      permissionMode: 'approve-all',
      sessionKey: 'agent:agent-1:main',
      createdAt: 1000,
      updatedAt: 1000,
    }

    const events = await collectStream(
      await runtime.send({
        agent,
        sessionId: 'main',
        sessionKey: agent.sessionKey,
        message: 'say hello',
        permissionMode: 'approve-all',
      }),
    )

    expect(events.map((event) => event.type)).toEqual([
      'status',
      'status',
      'text_delta',
      'tool_call',
      'done',
    ])
    expect(events[1]).toMatchObject({
      type: 'status',
      text: expect.stringContaining('Could not apply effort=medium'),
    })
  })

  it('reuses cached runtime instances across per-turn timeouts', async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const runtime = new AcpxRuntime({
      cwd: '/tmp/browseros-acpx-runtime',
      stateDir: '/tmp/browseros-acpx-state',
      runtimeFactory: (options) => {
        calls.push({ method: 'createRuntime', input: options })
        return createFakeAcpRuntime(calls)
      },
    })
    const agent: AgentDefinition = {
      id: 'agent-1',
      name: 'Codex bot',
      adapter: 'codex',
      modelId: 'gpt-5.5',
      reasoningEffort: 'medium',
      permissionMode: 'approve-all',
      sessionKey: 'agent:agent-1:main',
      createdAt: 1000,
      updatedAt: 1000,
    }

    await collectStream(
      await runtime.send({
        agent,
        sessionId: 'main',
        sessionKey: agent.sessionKey,
        message: 'first',
        permissionMode: 'approve-all',
        timeoutMs: 1_000,
      }),
    )
    await collectStream(
      await runtime.send({
        agent,
        sessionId: 'main',
        sessionKey: agent.sessionKey,
        message: 'second',
        permissionMode: 'approve-all',
        timeoutMs: 2_000,
      }),
    )

    expect(
      calls.filter((call) => call.method === 'createRuntime'),
    ).toHaveLength(1)
    expect(
      calls
        .filter((call) => call.method === 'startTurn')
        .map((call) => (call.input as { timeoutMs?: number }).timeoutMs),
    ).toEqual([1_000, 2_000])
  })
})

function createFakeAcpRuntime(
  calls: Array<{ method: string; input: unknown }>,
  options: { failConfig?: boolean } = {},
): AcpxCoreRuntime {
  return {
    async ensureSession(input) {
      calls.push({ method: 'ensureSession', input })
      return {
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: 'encoded-runtime-state',
        cwd: input.cwd,
        acpxRecordId: 'record-1',
      } satisfies AcpRuntimeHandle
    },
    startTurn(input) {
      calls.push({ method: 'startTurn', input })
      return {
        requestId: input.requestId,
        events: iterableEvents([
          {
            type: 'text_delta',
            text: 'Hello from fake runtime',
            stream: 'output',
            tag: 'agent_message_chunk',
          },
          {
            type: 'tool_call',
            text: 'Run tests (completed)',
            title: 'Run tests',
            toolCallId: 'tool-1',
            status: 'completed',
            tag: 'tool_call_update',
          },
        ]),
        result: Promise.resolve({
          status: 'completed',
          stopReason: 'end_turn',
        }),
        async cancel() {},
        async closeStream() {},
      }
    },
    async *runTurn() {},
    async setConfigOption(input) {
      calls.push({ method: 'setConfigOption', input })
      if (options.failConfig) {
        throw new Error('config key is not supported')
      }
    },
    async cancel() {},
    async close() {},
  }
}

async function* iterableEvents(events: AcpRuntimeEvent[]) {
  for (const event of events) yield event
}

async function collectStream(
  stream: ReadableStream<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const reader = stream.getReader()
  const events: AgentStreamEvent[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      events.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return events
}
