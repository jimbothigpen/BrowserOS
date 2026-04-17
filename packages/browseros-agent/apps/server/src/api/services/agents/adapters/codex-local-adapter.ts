import { mkdir } from 'node:fs/promises'
import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import { getAgentDir } from '../../../../lib/browseros-dir'
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

export class CodexLocalAgentAdapter implements BrowserOsAgentAdapter {
  readonly adapterType = 'codex_local' as const
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
      throw new Error('codex_local requires a configured binaryPath')
    }

    const agentCwd = getAgentDir(input.id)
    await mkdir(agentCwd, { recursive: true })

    const probe = await runCodexCommand({
      spawn: this.spawn,
      binaryPath,
      cwd: agentCwd,
      prompt: 'Respond with hello.',
    })

    if (probe.exitCode !== 0 || !/\bhello\b/i.test(probe.text)) {
      throw new Error('Codex hello probe failed')
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
    const process = this.spawn([binaryPath, 'exec', '--json', '-'], {
      cwd: record.paths.cwd,
      stdin: new TextEncoder().encode(prompt),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    return createCodexUiStream(process, `${record.id}-text`)
  }
}

function readRecordBinaryPath(record: BrowserOsStoredAgent): string {
  const binaryPath = normalizeBinaryPath(record.adapterConfig.binaryPath)
  if (!binaryPath) {
    throw new Error('codex_local requires adapterConfig.binaryPath')
  }
  return binaryPath
}

async function runCodexCommand(input: {
  spawn: SpawnLike
  binaryPath: string
  cwd: string
  prompt: string
}): Promise<{ exitCode: number; text: string; stderr: string }> {
  const process = input.spawn([input.binaryPath, 'exec', '--json', '-'], {
    cwd: input.cwd,
    stdin: new TextEncoder().encode(input.prompt),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    readStreamText(process.stdout),
    readStreamText(process.stderr),
    process.exited,
  ])

  const parsedText = parseCodexJsonlText(stdoutText).join('')
  return {
    exitCode,
    text: parsedText,
    stderr: stderrText,
  }
}

function createCodexUiStream(
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

      for (const delta of parseCodexJsonlText(stdoutText)) {
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
            stderrText.trim() || `Codex exited with status ${exitCode}`,
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

function parseCodexJsonlText(stdoutText: string): string[] {
  const deltas: string[] = []
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

    deltas.push(...extractTextParts(parsed))
  }

  return deltas
}

function extractTextParts(payload: Record<string, unknown>): string[] {
  const fromItem = extractFromItemEnvelope(payload.item)
  if (fromItem.length > 0) {
    return fromItem
  }

  const fromMessage = extractFromContentContainer(payload.message)
  if (fromMessage.length > 0) {
    return fromMessage
  }

  const fromContent = extractFromContentContainer(payload.content)
  if (fromContent.length > 0) {
    return fromContent
  }

  if (typeof payload.delta === 'string') {
    return [payload.delta]
  }
  if (typeof payload.text === 'string') {
    return [payload.text]
  }
  if (typeof payload.output_text === 'string') {
    return [payload.output_text]
  }

  return []
}

function extractFromItemEnvelope(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const item = value as Record<string, unknown>
  if (typeof item.text === 'string') {
    return [item.text]
  }

  return extractFromContentContainer(item)
}

function extractFromContentContainer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextPartsFromItem(item))
  }

  if (value && typeof value === 'object') {
    const content = (value as Record<string, unknown>).content
    if (Array.isArray(content)) {
      return content.flatMap((item) => extractTextPartsFromItem(item))
    }
  }

  return []
}

function extractTextPartsFromItem(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const item = value as Record<string, unknown>
  if (typeof item.text === 'string') {
    return [item.text]
  }
  if (typeof item.delta === 'string') {
    return [item.delta]
  }

  return []
}

function normalizeBinaryPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
