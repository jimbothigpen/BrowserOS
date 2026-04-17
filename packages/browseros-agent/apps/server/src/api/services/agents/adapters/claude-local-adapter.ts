import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import { getAgentDir, getAgentRuntimeDir } from '../../../../lib/browseros-dir'
import { buildLocalAgentPrompt } from './local-prompt'
import type {
  BrowserOsAgentAdapter,
  BrowserOsAgentChatInput,
  BrowserOsAgentCreateInput,
  BrowserOsAgentMaterializationResult,
} from './types'

interface SpawnResultLike {
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  exited: Promise<number>
}

interface SpawnOptionsLike {
  cwd?: string
  stdin?: Uint8Array
  stdout?: 'pipe'
  stderr?: 'pipe'
}

type SpawnLike = (cmd: string[], options: SpawnOptionsLike) => SpawnResultLike

const CLAUDE_SYSTEM_PROMPT_FILE_NAME = 'claude-system-prompt.md'

export class ClaudeLocalAgentAdapter implements BrowserOsAgentAdapter {
  readonly adapterType = 'claude_local' as const
  private readonly spawn: SpawnLike

  constructor(options: { spawn?: SpawnLike } = {}) {
    this.spawn =
      options.spawn ?? ((cmd, spawnOptions) => Bun.spawn(cmd, spawnOptions))
  }

  async validateCreate(input: BrowserOsAgentCreateInput): Promise<void> {
    if (input.adapterType !== this.adapterType) {
      throw new Error(`Unsupported adapter type: ${input.adapterType}`)
    }

    const binaryPath = normalizeBinaryPath(input.binaryPath)
    if (!binaryPath) {
      throw new Error('claude_local requires a configured binaryPath')
    }

    const agentCwd = getAgentDir(input.id)
    await mkdir(agentCwd, { recursive: true })

    const probe = await runClaudeCommand({
      spawn: this.spawn,
      binaryPath,
      cwd: agentCwd,
      prompt: 'Respond with hello.',
    })

    if (probe.exitCode !== 0 || !/\bhello\b/i.test(probe.text)) {
      throw new Error('Claude hello probe failed')
    }
  }

  async materialize(
    _input: BrowserOsAgentCreateInput,
  ): Promise<BrowserOsAgentMaterializationResult> {
    return {
      runtimeBinding: null,
    }
  }

  async remove(_record: BrowserOsStoredAgent): Promise<void> {}

  async streamChat(
    record: BrowserOsStoredAgent,
    input: BrowserOsAgentChatInput,
  ): Promise<ReadableStream<UIMessageStreamEvent>> {
    const binaryPath = readRecordBinaryPath(record)
    const prompt = await buildLocalAgentPrompt(record, {
      message: input.message,
      conversation: input.conversation,
    })
    const systemPromptFile = await writeClaudeSystemPromptFile(record)
    const process = this.spawn(
      [
        binaryPath,
        '--print',
        '-',
        '--output-format',
        'stream-json',
        '--verbose',
        '--append-system-prompt-file',
        systemPromptFile,
      ],
      {
        cwd: record.paths.cwd,
        stdin: new TextEncoder().encode(prompt),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    return createClaudeUiStream(process, `${record.id}-text`)
  }
}

function readRecordBinaryPath(record: BrowserOsStoredAgent): string {
  const binaryPath = normalizeBinaryPath(record.adapterConfig.binaryPath)
  if (!binaryPath) {
    throw new Error('claude_local requires adapterConfig.binaryPath')
  }
  return binaryPath
}

async function runClaudeCommand(input: {
  spawn: SpawnLike
  binaryPath: string
  cwd: string
  prompt: string
}): Promise<{ exitCode: number; text: string; stderr: string }> {
  const process = input.spawn(
    [
      input.binaryPath,
      '--print',
      '-',
      '--output-format',
      'stream-json',
      '--verbose',
    ],
    {
      cwd: input.cwd,
      stdin: new TextEncoder().encode(input.prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    readStreamText(process.stdout),
    readStreamText(process.stderr),
    process.exited,
  ])

  return {
    exitCode,
    text: parseClaudeStreamJson(stdoutText).join(''),
    stderr: stderrText,
  }
}

async function writeClaudeSystemPromptFile(
  record: BrowserOsStoredAgent,
): Promise<string> {
  const runtimeDir = getAgentRuntimeDir(record.id)
  await mkdir(runtimeDir, { recursive: true })

  const [agentsMd, soulMd, toolsMd] = await Promise.all([
    readFile(join(record.paths.agentDir, 'AGENTS.md'), 'utf8'),
    readFile(join(record.paths.agentDir, 'SOUL.md'), 'utf8'),
    readFile(join(record.paths.agentDir, 'TOOLS.md'), 'utf8'),
  ])

  const filePath = join(runtimeDir, CLAUDE_SYSTEM_PROMPT_FILE_NAME)
  const content = [
    '# BrowserOS Claude System Prompt',
    '',
    '## AGENTS.md',
    agentsMd.trim(),
    '',
    '## SOUL.md',
    soulMd.trim(),
    '',
    '## TOOLS.md',
    toolsMd.trim(),
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

function createClaudeUiStream(
  process: SpawnResultLike,
  textId: string,
): ReadableStream<UIMessageStreamEvent> {
  return new ReadableStream<UIMessageStreamEvent>({
    async start(controller) {
      controller.enqueue({ type: 'start' })
      controller.enqueue({ type: 'text-start', id: textId })

      const [stdoutText, stderrText, exitCode] = await Promise.all([
        readStreamText(process.stdout),
        readStreamText(process.stderr),
        process.exited,
      ])

      for (const delta of parseClaudeStreamJson(stdoutText)) {
        controller.enqueue({
          type: 'text-delta',
          id: textId,
          delta,
        })
      }

      if (exitCode !== 0) {
        controller.enqueue({
          type: 'error',
          errorText:
            stderrText.trim() || `Claude exited with status ${exitCode}`,
        })
      }

      controller.enqueue({ type: 'text-end', id: textId })
      controller.enqueue({
        type: 'finish',
        finishReason: exitCode === 0 ? 'stop' : 'error',
      })
      controller.close()
    },
  })
}

async function readStreamText(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) {
    return ''
  }

  return new Response(stream).text()
}

function parseClaudeStreamJson(stdoutText: string): string[] {
  const textParts: string[] = []
  const lines = stdoutText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    textParts.push(...extractClaudeText(parsed))
  }

  return textParts
}

function extractClaudeText(payload: Record<string, unknown>): string[] {
  const message = payload.message
  if (message && typeof message === 'object') {
    return extractClaudeContentBlocks(
      (message as Record<string, unknown>).content,
    )
  }

  return extractClaudeContentBlocks(payload.content)
}

function extractClaudeContentBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((block) => {
    if (!block || typeof block !== 'object') {
      return []
    }

    const item = block as Record<string, unknown>
    if (item.type !== 'text') {
      return []
    }

    return typeof item.text === 'string' ? [item.text] : []
  })
}

function normalizeBinaryPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
