/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import type { OpenClawAgentEntry } from '../../../../src/api/services/openclaw/openclaw-service'

type MutableOpenClawService = {
  getStatus: ReturnType<typeof mock>
  createAgent: ReturnType<typeof mock>
  removeAgent: ReturnType<typeof mock>
  chatStream: ReturnType<typeof mock>
  listAgents: ReturnType<typeof mock>
}

describe('OpenClawAgentAdapter', () => {
  let service: MutableOpenClawService

  beforeEach(() => {
    service = {
      getStatus: mock(async () => ({
        status: 'running',
        podmanAvailable: true,
        machineReady: true,
        port: 18789,
        agentCount: 1,
        error: null,
        controlPlaneStatus: 'connected',
        lastGatewayError: null,
        lastRecoveryReason: null,
      })),
      createAgent: mock(async () => ({
        agentId: 'ops',
        name: 'ops',
        workspace: '/workspace/ops',
        model: 'openclaw/ops',
      })),
      removeAgent: mock(async () => {}),
      chatStream: mock(
        async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'text-delta',
                data: { text: 'Hello' },
              })
              controller.enqueue({
                type: 'text-delta',
                data: { text: ' world' },
              })
              controller.enqueue({
                type: 'done',
                data: { text: 'Hello world' },
              })
              controller.close()
            },
          }),
      ),
      listAgents: mock(async () => []),
    }
  })

  afterEach(() => {
    mock.restore()
  })

  it('rejects create when OpenClaw is not ready', async () => {
    service.getStatus = mock(async () => ({
      status: 'starting',
      podmanAvailable: true,
      machineReady: true,
      port: 18789,
      agentCount: 0,
      error: null,
      controlPlaneStatus: 'connecting',
      lastGatewayError: null,
      lastRecoveryReason: null,
    }))

    const { OpenClawAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/openclaw-adapter'
    )
    const adapter = new OpenClawAgentAdapter(service as never)

    await expect(
      adapter.validateCreate({
        id: 'ops',
        name: 'Ops',
        adapterType: 'openclaw',
      }),
    ).rejects.toThrow('OpenClaw must be running with a connected control plane')
  })

  it('materializes, removes, and streams via OpenClaw', async () => {
    const { OpenClawAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/openclaw-adapter'
    )
    const adapter = new OpenClawAgentAdapter(service as never)

    const materialized = await adapter.materialize({
      id: 'ops',
      name: 'Ops',
      adapterType: 'openclaw',
      roleId: 'chief-of-staff',
      providerType: 'openai',
      providerName: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      modelId: 'gpt-4o-mini',
    })

    expect(service.createAgent).toHaveBeenCalledWith({
      name: 'ops',
      providerType: 'openai',
      providerName: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      modelId: 'gpt-4o-mini',
    })
    expect(materialized).toEqual({
      runtimeBinding: {
        agentId: 'ops',
        workspace: '/workspace/ops',
        model: 'openclaw/ops',
      },
      adapterConfig: {
        providerType: 'openai',
        providerName: 'openai',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'gpt-4o-mini',
      },
    })

    const record = createStoredAgent({
      runtimeBinding: {
        agentId: 'ops-runtime',
      },
    })

    await adapter.remove(record)
    expect(service.removeAgent).toHaveBeenCalledWith('ops-runtime')

    const stream = await adapter.streamChat(record, {
      sessionKey: 'session-123',
      message: 'hi',
    })
    expect(service.chatStream).toHaveBeenCalledWith(
      'ops-runtime',
      'session-123',
      'hi',
    )
    expect(await readEvents(stream)).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'ops-runtime-text' },
      { type: 'text-delta', id: 'ops-runtime-text', delta: 'Hello' },
      { type: 'text-delta', id: 'ops-runtime-text', delta: ' world' },
      { type: 'text-end', id: 'ops-runtime-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('preserves thinking, tool, and lifecycle details in normalized chat output', async () => {
    service.chatStream = mock(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'thinking',
              data: { text: 'Inspecting context' },
            })
            controller.enqueue({
              type: 'tool-start',
              data: {
                toolCallId: 'call-1',
                toolName: 'browser.search',
                input: { query: 'BrowserOS' },
              },
            })
            controller.enqueue({
              type: 'tool-output',
              data: {
                toolCallId: 'call-1',
                output: { result: 'ok' },
              },
            })
            controller.enqueue({
              type: 'tool-end',
              data: {
                toolCallId: 'call-1',
                status: 'completed',
              },
            })
            controller.enqueue({
              type: 'lifecycle',
              data: {
                phase: 'retrieval',
                status: 'running',
              },
            })
            controller.enqueue({
              type: 'done',
              data: { text: '' },
            })
            controller.close()
          },
        }),
    )

    const { OpenClawAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/openclaw-adapter'
    )
    const adapter = new OpenClawAgentAdapter(service as never)

    const stream = await adapter.streamChat(createStoredAgent(), {
      sessionKey: 'session-456',
      message: 'status',
    })

    expect(await readEvents(stream)).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'ops-text' },
      { type: 'reasoning-start', id: 'ops-reasoning' },
      {
        type: 'reasoning-delta',
        id: 'ops-reasoning',
        delta: 'Inspecting context',
      },
      {
        type: 'tool-input-start',
        toolCallId: 'call-1',
        toolName: 'browser.search',
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'browser.search',
        input: { query: 'BrowserOS' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call-1',
        output: { result: 'ok' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call-1',
        output: { status: 'completed' },
      },
      {
        type: 'reasoning-delta',
        id: 'ops-reasoning',
        delta: '{"phase":"retrieval","status":"running"}',
      },
      { type: 'reasoning-end', id: 'ops-reasoning' },
      { type: 'text-end', id: 'ops-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('keeps a synthetic toolCallId stable across tool-start, tool-output, and tool-end when OpenClaw omits it', async () => {
    service.chatStream = mock(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'tool-start',
              data: {
                toolName: 'browser.search',
                input: { query: 'BrowserOS agents' },
              },
            })
            controller.enqueue({
              type: 'tool-output',
              data: {
                output: { result: 'ok' },
              },
            })
            controller.enqueue({
              type: 'tool-end',
              data: {
                status: 'completed',
              },
            })
            controller.enqueue({
              type: 'done',
              data: { text: '' },
            })
            controller.close()
          },
        }),
    )

    const { OpenClawAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/openclaw-adapter'
    )
    const adapter = new OpenClawAgentAdapter(service as never)

    const events = await readEvents(
      await adapter.streamChat(createStoredAgent(), {
        sessionKey: 'session-missing-tool-id',
        message: 'run search',
      }),
    )

    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'ops-text' },
      {
        type: 'tool-input-start',
        toolCallId: 'ops-text-tool-1',
        toolName: 'browser.search',
      },
      {
        type: 'tool-input-available',
        toolCallId: 'ops-text-tool-1',
        toolName: 'browser.search',
        input: { query: 'BrowserOS agents' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'ops-text-tool-1',
        output: { result: 'ok' },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'ops-text-tool-1',
        output: { status: 'completed' },
      },
      { type: 'text-end', id: 'ops-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })
})

describe('BrowserOsAgentService', () => {
  let homeDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'browseros-agent-service-'))
    mock.module('node:os', () => ({
      homedir: () => homeDir,
    }))
  })

  afterEach(async () => {
    mock.restore()
    await rm(homeDir, { recursive: true, force: true })
  })

  it('imports existing OpenClaw agents into the BrowserOS registry on list', async () => {
    const openClawService: MutableOpenClawService = {
      getStatus: mock(async () => ({
        status: 'running',
        podmanAvailable: true,
        machineReady: true,
        port: 18789,
        agentCount: 1,
        error: null,
        controlPlaneStatus: 'connected',
        lastGatewayError: null,
        lastRecoveryReason: null,
      })),
      createAgent: mock(async () => {
        throw new Error('not used')
      }),
      removeAgent: mock(async () => {}),
      chatStream: mock(
        async () =>
          new ReadableStream({
            start(controller) {
              controller.close()
            },
          }),
      ),
      listAgents: mock(async () => [
        {
          agentId: 'research',
          name: 'research',
          workspace: '/workspace/research',
          model: 'openclaw/research',
        } satisfies OpenClawAgentEntry,
      ]),
    }

    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )
    const { OpenClawAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/openclaw-adapter'
    )
    const { BrowserOsAgentService } = await import(
      '../../../../src/api/services/agents/agent-service'
    )

    const registry = new AgentRegistryService()
    const browserOsAgentService = new BrowserOsAgentService({
      registry,
      adapters: [new OpenClawAgentAdapter(openClawService as never)],
      openClawService: openClawService as never,
    })

    const agents = await browserOsAgentService.list()

    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({
      id: 'research',
      name: 'research',
      adapterType: 'openclaw',
      runtimeBinding: {
        agentId: 'research',
        workspace: '/workspace/research',
        model: 'openclaw/research',
      },
    })

    const persisted = await registry.get('research')
    expect(persisted).toMatchObject({
      id: 'research',
      adapterType: 'openclaw',
    })
    expect(
      await readFile(
        join(persisted?.paths.agentDir ?? '', 'AGENTS.md'),
        'utf8',
      ),
    ).toContain('You are a BrowserOS-managed agent for this workspace.')
  })

  it('imports an existing OpenClaw agent on direct get without a prior list call', async () => {
    const fixture = await createAgentServiceFixture(homeDir)

    const agent = await fixture.browserOsAgentService.get('research')

    expect(agent).toMatchObject({
      id: 'research',
      adapterType: 'openclaw',
      runtimeBinding: {
        agentId: 'research',
      },
    })
  })

  it('imports an existing OpenClaw agent on direct chat without a prior list call', async () => {
    const fixture = await createAgentServiceFixture(homeDir)

    const stream = await fixture.browserOsAgentService.chat('research', {
      sessionKey: 'session-direct-chat',
      message: 'hello',
    })

    expect(fixture.openClawService.chatStream).toHaveBeenCalledWith(
      'research',
      'session-direct-chat',
      'hello',
    )
    expect(await readEvents(stream)).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'research-text' },
      { type: 'text-delta', id: 'research-text', delta: 'Imported' },
      { type: 'text-end', id: 'research-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('imports an existing OpenClaw agent on direct remove without a prior list call', async () => {
    const fixture = await createAgentServiceFixture(homeDir)

    await fixture.browserOsAgentService.remove('research')

    expect(fixture.openClawService.removeAgent).toHaveBeenCalledWith('research')
    expect(await fixture.registry.get('research')).toBeNull()
  })

  it('rejects creating a local agent when an OpenClaw runtime agent already uses the id', async () => {
    const fixture = await createAgentServiceFixture(homeDir)
    const localAdapter = createLocalAdapterStub('codex_local')

    const { BrowserOsAgentService } = await import(
      '../../../../src/api/services/agents/agent-service'
    )

    const browserOsAgentService = new BrowserOsAgentService({
      registry: fixture.registry,
      adapters: [
        new (
          await import(
            '../../../../src/api/services/agents/adapters/openclaw-adapter'
          )
        ).OpenClawAgentAdapter(fixture.openClawService as never),
        localAdapter,
      ],
      openClawService: fixture.openClawService as never,
    })

    await expect(
      browserOsAgentService.create({
        id: 'research',
        name: 'research',
        adapterType: 'codex_local',
        binaryPath: '/opt/homebrew/bin/codex',
      }),
    ).rejects.toThrow('Agent "research" already exists')

    expect(await fixture.registry.get('research')).toMatchObject({
      id: 'research',
      adapterType: 'openclaw',
    })
  })
})

async function createAgentServiceFixture(homeDir: string): Promise<{
  registry: InstanceType<
    typeof import('../../../../src/api/services/agents/agent-registry-service').AgentRegistryService
  >
  browserOsAgentService: InstanceType<
    typeof import('../../../../src/api/services/agents/agent-service').BrowserOsAgentService
  >
  openClawService: MutableOpenClawService
}> {
  const openClawService: MutableOpenClawService = {
    getStatus: mock(async () => ({
      status: 'running',
      podmanAvailable: true,
      machineReady: true,
      port: 18789,
      agentCount: 1,
      error: null,
      controlPlaneStatus: 'connected',
      lastGatewayError: null,
      lastRecoveryReason: null,
    })),
    createAgent: mock(async () => {
      throw new Error('not used')
    }),
    removeAgent: mock(async () => {}),
    chatStream: mock(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              data: { text: 'Imported' },
            })
            controller.enqueue({
              type: 'done',
              data: { text: 'Imported' },
            })
            controller.close()
          },
        }),
    ),
    listAgents: mock(async () => [
      {
        agentId: 'research',
        name: 'research',
        workspace: join(homeDir, 'workspace', 'research'),
        model: 'openclaw/research',
      } satisfies OpenClawAgentEntry,
    ]),
  }

  const { AgentRegistryService } = await import(
    '../../../../src/api/services/agents/agent-registry-service'
  )
  const { OpenClawAgentAdapter } = await import(
    '../../../../src/api/services/agents/adapters/openclaw-adapter'
  )
  const { BrowserOsAgentService } = await import(
    '../../../../src/api/services/agents/agent-service'
  )

  const registry = new AgentRegistryService()
  const browserOsAgentService = new BrowserOsAgentService({
    registry,
    adapters: [new OpenClawAgentAdapter(openClawService as never)],
    openClawService: openClawService as never,
  })

  return {
    registry,
    browserOsAgentService,
    openClawService,
  }
}

function createStoredAgent(
  overrides: Partial<BrowserOsStoredAgent> = {},
): BrowserOsStoredAgent {
  return {
    version: 1,
    id: 'ops',
    name: 'Ops',
    adapterType: 'openclaw',
    paths: {
      agentDir: '/agents/ops',
      cwd: '/agents/ops',
      contextDirs: [],
    },
    adapterConfig: {},
    runtimeBinding: null,
    lastValidation: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createLocalAdapterStub(adapterType: 'codex_local' | 'claude_local') {
  return {
    adapterType,
    validateCreate: mock(async () => {}),
    materialize: mock(async () => ({
      runtimeBinding: null,
    })),
    remove: mock(async () => {}),
    streamChat: mock(async () => new ReadableStream()),
  }
}

async function readEvents(
  stream: ReadableStream<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader()
  const events: Record<string, unknown>[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }

  return events
}
