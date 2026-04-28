/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrowserosDir } from '../browseros-dir'
import { logger } from '../logger'
import type { AgentTranscriptEntry } from './agent-types'

export interface TranscriptListInput {
  agentId: string
  sessionId: 'main'
}

export interface TranscriptAppendInput {
  agentId: string
  sessionId: 'main'
  role: 'user' | 'assistant'
  text: string
}

export class FileTranscriptStore {
  private readonly rootDir: string

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir =
      options.rootDir ??
      join(getBrowserosDir(), 'agents', 'harness', 'transcripts')
  }

  async append(input: TranscriptAppendInput): Promise<AgentTranscriptEntry> {
    const entry: AgentTranscriptEntry = {
      id: randomUUID(),
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      createdAt: Date.now(),
    }
    const filePath = this.pathFor(input)
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
    logger.debug('Agent harness transcript appended entry', {
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      role: entry.role,
      textLength: entry.text.length,
      filePath,
    })
    return entry
  }

  async list(input: TranscriptListInput): Promise<AgentTranscriptEntry[]> {
    try {
      const raw = await readFile(this.pathFor(input), 'utf8')
      const entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => this.parseLine(line, input))
        .filter((entry): entry is AgentTranscriptEntry => entry !== null)
        .sort((a, b) => a.createdAt - b.createdAt)
      logger.debug('Agent harness transcript listed entries', {
        agentId: input.agentId,
        sessionId: input.sessionId,
        count: entries.length,
        filePath: this.pathFor(input),
      })
      return entries
    } catch (err) {
      if (isNotFoundError(err)) {
        logger.debug('Agent harness transcript file missing', {
          agentId: input.agentId,
          sessionId: input.sessionId,
          filePath: this.pathFor(input),
        })
        return []
      }
      throw err
    }
  }

  private pathFor(input: TranscriptListInput): string {
    return join(this.rootDir, input.agentId, `${input.sessionId}.jsonl`)
  }

  private parseLine(
    line: string,
    input: TranscriptListInput,
  ): AgentTranscriptEntry | null {
    try {
      return JSON.parse(line) as AgentTranscriptEntry
    } catch (err) {
      logger.warn('Agent harness transcript skipped malformed line', {
        agentId: input.agentId,
        sessionId: input.sessionId,
        filePath: this.pathFor(input),
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  )
}
