/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileAgentStore } from '../../../src/lib/agents/file-agent-store'

describe('FileAgentStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  it('creates, lists, loads, and deletes named agents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'browseros-agents-'))
    tempDirs.push(dir)
    const store = new FileAgentStore({ filePath: join(dir, 'agents.json') })

    const agent = await store.create({
      name: 'Review bot',
      adapter: 'codex',
      modelId: 'gpt-5.5',
      reasoningEffort: 'medium',
    })

    expect(agent).toMatchObject({
      name: 'Review bot',
      adapter: 'codex',
      modelId: 'gpt-5.5',
      reasoningEffort: 'medium',
      permissionMode: 'approve-all',
      sessionKey: `agent:${agent.id}:main`,
    })
    expect(await store.list()).toEqual([agent])
    expect(await store.get(agent.id)).toEqual(agent)

    await store.delete(agent.id)
    expect(await store.list()).toEqual([])
  })
})
