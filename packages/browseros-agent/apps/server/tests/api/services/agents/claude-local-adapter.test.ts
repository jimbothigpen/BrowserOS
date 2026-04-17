/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'

interface SpawnInvocation {
  cmd: string[]
  cwd?: string
  stdinText: string
}

describe('ClaudeLocalAgentAdapter', () => {
  let homeDir: string
  let invocations: SpawnInvocation[]

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'browseros-claude-local-'))
    invocations = []
    mock.module('node:os', () => ({
      homedir: () => homeDir,
    }))
  })

  afterEach(async () => {
    mock.restore()
    await rm(homeDir, { recursive: true, force: true })
  })

  it('rejects create when binaryPath is missing or empty', async () => {
    const { ClaudeLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/claude-local-adapter'
    )
    const adapter = new ClaudeLocalAgentAdapter({
      spawn: mock(() => {
        throw new Error('not used')
      }),
    })

    await expect(
      adapter.validateCreate({
        id: 'claude-agent',
        name: 'Claude Agent',
        adapterType: 'claude_local',
        binaryPath: '   ',
      }),
    ).rejects.toThrow('claude_local requires a configured binaryPath')
  })

  it('rejects create when the hello probe fails', async () => {
    const spawn = mock(
      (cmd: string[], options?: { cwd?: string; stdin?: unknown }) => {
        invocations.push({
          cmd,
          cwd: options?.cwd,
          stdinText: decodeStdin(options?.stdin),
        })
        return createMockProcess({
          stdoutLines: [
            JSON.stringify({
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'goodbye' }],
              },
            }),
          ],
        })
      },
    )
    const { ClaudeLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/claude-local-adapter'
    )
    const adapter = new ClaudeLocalAgentAdapter({ spawn })

    await expect(
      adapter.validateCreate({
        id: 'claude-agent',
        name: 'Claude Agent',
        adapterType: 'claude_local',
        binaryPath: '/usr/local/bin/claude',
      }),
    ).rejects.toThrow('Claude hello probe failed')

    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toEqual({
      cmd: [
        '/usr/local/bin/claude',
        '--print',
        '-',
        '--output-format',
        'stream-json',
        '--verbose',
      ],
      cwd: join(homeDir, '.browseros', 'agents', 'claude-agent'),
      stdinText: 'Respond with hello.',
    })
  })

  it('writes the Claude system prompt file and normalizes assistant content blocks into text events', async () => {
    const agentDir = join(homeDir, 'agents', 'claude-agent')
    const runtimeDir = join(
      homeDir,
      '.browseros',
      'agents',
      'claude-agent',
      'runtime',
    )
    const agentCwd = join(homeDir, 'workspace', 'claude-agent')
    await mkdir(agentDir, { recursive: true })
    await mkdir(runtimeDir, { recursive: true })
    await mkdir(agentCwd, { recursive: true })
    await writeFile(
      join(agentDir, 'AGENTS.md'),
      '# Agent Rules\nFollow the BrowserOS plan.\n',
    )
    await writeFile(join(agentDir, 'SOUL.md'), '# Soul\nStay calm.\n')
    await writeFile(join(agentDir, 'TOOLS.md'), '# Tools\nUse the workspace.\n')

    const spawn = mock(
      (cmd: string[], options?: { cwd?: string; stdin?: unknown }) => {
        invocations.push({
          cmd,
          cwd: options?.cwd,
          stdinText: decodeStdin(options?.stdin),
        })
        return createMockProcess({
          stdoutLines: [
            JSON.stringify({
              type: 'assistant',
              message: {
                content: [
                  { type: 'text', text: 'Hello' },
                  { type: 'tool_use', name: 'search' },
                  { type: 'text', text: ' world' },
                ],
              },
            }),
            JSON.stringify({
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: '!' }],
              },
            }),
          ],
        })
      },
    )
    const { ClaudeLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/claude-local-adapter'
    )
    const adapter = new ClaudeLocalAgentAdapter({ spawn })
    const record = createStoredAgent({
      id: 'claude-agent',
      name: 'Claude Agent',
      adapterType: 'claude_local',
      paths: {
        agentDir,
        cwd: agentCwd,
        contextDirs: [],
      },
      adapterConfig: {
        binaryPath: '/usr/local/bin/claude',
      },
    })

    expect(
      await adapter.materialize({
        id: 'claude-agent',
        name: 'Claude Agent',
        adapterType: 'claude_local',
        binaryPath: '/usr/local/bin/claude',
      }),
    ).toEqual({
      runtimeBinding: null,
    })
    await expect(adapter.remove(record)).resolves.toBeUndefined()

    const stream = await adapter.streamChat(record, {
      sessionKey: 'session-123',
      conversation: [
        { role: 'user', text: 'What happened yesterday?' },
        { role: 'assistant', text: 'We finished the migration.' },
      ],
      message: 'Summarize the current state.',
    } as never)

    expect(invocations).toHaveLength(1)
    expect(invocations[0]?.cmd).toEqual([
      '/usr/local/bin/claude',
      '--print',
      '-',
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt-file',
      join(runtimeDir, 'claude-system-prompt.md'),
    ])
    expect(invocations[0]?.cwd).toBe(agentCwd)
    expect(invocations[0]?.stdinText).toContain('What happened yesterday?')
    expect(invocations[0]?.stdinText).toContain('We finished the migration.')
    expect(invocations[0]?.stdinText).toContain('Summarize the current state.')

    const systemPrompt = await readFile(
      join(runtimeDir, 'claude-system-prompt.md'),
      'utf8',
    )
    expect(systemPrompt).toContain('# Agent Rules')
    expect(systemPrompt).toContain('# Soul')
    expect(systemPrompt).toContain('# Tools')

    expect(await readEvents(stream)).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'claude-agent-text' },
      { type: 'text-delta', id: 'claude-agent-text', delta: 'Hello' },
      { type: 'text-delta', id: 'claude-agent-text', delta: ' world' },
      { type: 'text-delta', id: 'claude-agent-text', delta: '!' },
      { type: 'text-end', id: 'claude-agent-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('persists binaryPath through BrowserOsAgentService create for claude_local agents and exposes default local adapters', async () => {
    const spawn = mock(
      (cmd: string[], options?: { cwd?: string; stdin?: unknown }) => {
        invocations.push({
          cmd,
          cwd: options?.cwd,
          stdinText: decodeStdin(options?.stdin),
        })
        return createMockProcess({
          stdoutLines: [
            JSON.stringify({
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'hello' }],
              },
            }),
          ],
        })
      },
    )

    const { ClaudeLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/claude-local-adapter'
    )
    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )
    const { BrowserOsAgentService } = await import(
      '../../../../src/api/services/agents/agent-service'
    )

    const registry = new AgentRegistryService()
    const browserOsAgentService = new BrowserOsAgentService({
      registry,
      adapters: [new ClaudeLocalAgentAdapter({ spawn })],
      openClawService: {} as never,
    })

    const created = await browserOsAgentService.create({
      id: 'claude-agent',
      name: 'Claude Agent',
      adapterType: 'claude_local',
      binaryPath: '/usr/local/bin/claude',
    })

    expect(created.runtimeBinding).toBeNull()
    expect(created.adapterConfig).toEqual({
      binaryPath: '/usr/local/bin/claude',
    })
    expect((await registry.get('claude-agent'))?.adapterConfig).toEqual({
      binaryPath: '/usr/local/bin/claude',
    })

    const defaultService = new BrowserOsAgentService({
      openClawService: {} as never,
    })
    expect(defaultService.catalog()).toEqual([
      { adapterType: 'openclaw', label: 'OpenClaw' },
      { adapterType: 'codex_local', label: 'Codex Local' },
      { adapterType: 'claude_local', label: 'Claude Local' },
    ])
  })

  it('rolls back the registry record when materialize fails after create', async () => {
    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )
    const { BrowserOsAgentService } = await import(
      '../../../../src/api/services/agents/agent-service'
    )

    const materializeError = new Error('materialize failed')
    const remove = mock(async () => {})
    const registry = new AgentRegistryService()
    const browserOsAgentService = new BrowserOsAgentService({
      registry,
      adapters: [
        {
          adapterType: 'claude_local',
          validateCreate: mock(async () => {}),
          materialize: mock(async () => {
            throw materializeError
          }),
          remove,
          streamChat: mock(async () => {
            throw new Error('not used')
          }),
        } as never,
      ],
      openClawService: {} as never,
    })

    await expect(
      browserOsAgentService.create({
        id: 'broken-claude-agent',
        name: 'Broken Claude Agent',
        adapterType: 'claude_local',
        binaryPath: '/usr/local/bin/claude',
      }),
    ).rejects.toThrow('materialize failed')

    expect(remove).toHaveBeenCalledTimes(1)
    expect(await registry.get('broken-claude-agent')).toBeNull()
  })
})

function createStoredAgent(
  overrides: Partial<BrowserOsStoredAgent> = {},
): BrowserOsStoredAgent {
  return {
    version: 1,
    id: 'agent',
    name: 'Agent',
    adapterType: 'claude_local',
    paths: {
      agentDir: '/tmp/agent',
      cwd: '/tmp/agent',
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

function createMockProcess(input: {
  stdoutLines?: string[]
  stderrLines?: string[]
  exitCode?: number
}) {
  return {
    stdout: createByteStream(input.stdoutLines ?? []),
    stderr: createByteStream(input.stderrLines ?? []),
    exited: Promise.resolve(input.exitCode ?? 0),
  }
}

function createByteStream(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })
}

function decodeStdin(stdin: unknown): string {
  if (stdin instanceof Uint8Array) {
    return new TextDecoder().decode(stdin)
  }

  return String(stdin ?? '')
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
