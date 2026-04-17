/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'

interface SpawnInvocation {
  cmd: string[]
  cwd?: string
  stdinText: string
}

describe('CodexLocalAgentAdapter', () => {
  let homeDir: string
  let invocations: SpawnInvocation[]

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'browseros-codex-local-'))
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
    const { CodexLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/codex-local-adapter'
    )
    const adapter = new CodexLocalAgentAdapter({
      spawn: mock(() => {
        throw new Error('not used')
      }),
    })

    await expect(
      adapter.validateCreate({
        id: 'codex-agent',
        name: 'Codex Agent',
        adapterType: 'codex_local',
        binaryPath: '   ',
      } as never),
    ).rejects.toThrow('codex_local requires a configured binaryPath')
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
                content: [{ type: 'output_text', text: 'goodbye' }],
              },
            }),
          ],
        })
      },
    )
    const { CodexLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/codex-local-adapter'
    )
    const adapter = new CodexLocalAgentAdapter({ spawn })

    await expect(
      adapter.validateCreate({
        id: 'codex-agent',
        name: 'Codex Agent',
        adapterType: 'codex_local',
        binaryPath: '/usr/local/bin/codex',
      } as never),
    ).rejects.toThrow('Codex hello probe failed')

    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toEqual({
      cmd: ['/usr/local/bin/codex', 'exec', '--json', '-'],
      cwd: join(homeDir, '.browseros', 'agents', 'codex-agent'),
      stdinText: 'Respond with hello.',
    })
  })

  it('builds the local prompt and normalizes codex JSONL stdout into text events', async () => {
    const agentDir = join(homeDir, 'agents', 'codex-agent')
    const agentCwd = join(homeDir, 'workspace', 'codex-agent')
    await mkdir(agentDir, { recursive: true })
    await mkdir(agentCwd, { recursive: true })
    await writeFile(
      join(agentDir, 'AGENTS.md'),
      '# Agent Rules\nDo the task.\n',
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
              type: 'item.completed',
              item: {
                type: 'agent_message',
                text: 'Hello',
              },
            }),
            JSON.stringify({
              type: 'response.output_text.delta',
              delta: ' world',
            }),
            JSON.stringify({
              type: 'message',
              text: '!',
            }),
          ],
        })
      },
    )
    const { CodexLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/codex-local-adapter'
    )
    const adapter = new CodexLocalAgentAdapter({ spawn })
    const record = createStoredAgent({
      id: 'codex-agent',
      name: 'Codex Agent',
      adapterType: 'codex_local',
      paths: {
        agentDir,
        cwd: agentCwd,
        contextDirs: [],
      },
      adapterConfig: {
        binaryPath: '/usr/local/bin/codex',
      },
    })

    expect(
      await adapter.materialize({
        id: 'codex-agent',
        name: 'Codex Agent',
        adapterType: 'codex_local',
        binaryPath: '/usr/local/bin/codex',
      } as never),
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
      '/usr/local/bin/codex',
      'exec',
      '--json',
      '-',
    ])
    expect(invocations[0]?.cwd).toBe(agentCwd)
    expect(invocations[0]?.stdinText).toContain('# Agent Rules')
    expect(invocations[0]?.stdinText).toContain('# Soul')
    expect(invocations[0]?.stdinText).toContain('# Tools')
    expect(invocations[0]?.stdinText).toContain('What happened yesterday?')
    expect(invocations[0]?.stdinText).toContain('We finished the migration.')
    expect(invocations[0]?.stdinText).toContain('Summarize the current state.')

    expect(await readEvents(stream)).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'codex-agent-text' },
      { type: 'text-delta', id: 'codex-agent-text', delta: 'Hello' },
      { type: 'text-delta', id: 'codex-agent-text', delta: ' world' },
      { type: 'text-delta', id: 'codex-agent-text', delta: '!' },
      { type: 'text-end', id: 'codex-agent-text' },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('persists binaryPath through BrowserOsAgentService create for codex_local agents', async () => {
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
              type: 'item.completed',
              item: {
                type: 'agent_message',
                text: 'hello',
              },
            }),
          ],
        })
      },
    )

    const { CodexLocalAgentAdapter } = await import(
      '../../../../src/api/services/agents/adapters/codex-local-adapter'
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
      adapters: [new CodexLocalAgentAdapter({ spawn })],
      openClawService: {} as never,
    })

    const created = await browserOsAgentService.create({
      id: 'codex-agent',
      name: 'Codex Agent',
      adapterType: 'codex_local',
      binaryPath: '/usr/local/bin/codex',
    })

    expect(created.adapterConfig).toEqual({
      binaryPath: '/usr/local/bin/codex',
    })
    expect((await registry.get('codex-agent'))?.adapterConfig).toEqual({
      binaryPath: '/usr/local/bin/codex',
    })
  })
})

function createStoredAgent(
  overrides: Partial<BrowserOsStoredAgent> = {},
): BrowserOsStoredAgent {
  return {
    version: 1,
    id: 'agent',
    name: 'Agent',
    adapterType: 'codex_local',
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
