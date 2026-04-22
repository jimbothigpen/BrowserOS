import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expandMatrix, readAgentsConfig } from '../src/catalog'

const tempPaths: string[] = []

async function writeTempConfig(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-container-catalog-'))
  const filePath = join(dir, 'agents.json')
  tempPaths.push(dir)
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
  return filePath
}

afterEach(async () => {
  await Promise.all(
    tempPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('catalog', () => {
  it('reads and expands the agent matrix', async () => {
    const path = await writeTempConfig({
      schema: 'v1',
      agents: [
        {
          name: 'openclaw',
          image: 'ghcr.io/openclaw/openclaw',
          version: '2026.4.12',
          arches: ['amd64', 'arm64'],
        },
      ],
    })

    const config = await readAgentsConfig(path)
    expect(expandMatrix(config)).toEqual([
      {
        agent: 'openclaw',
        image: 'ghcr.io/openclaw/openclaw',
        version: '2026.4.12',
        arch: 'amd64',
        publishAs: 'openclaw',
      },
      {
        agent: 'openclaw',
        image: 'ghcr.io/openclaw/openclaw',
        version: '2026.4.12',
        arch: 'arm64',
        publishAs: 'openclaw',
      },
    ])
  })

  it('filters the matrix by agent name', async () => {
    const path = await writeTempConfig({
      schema: 'v1',
      agents: [
        {
          name: 'openclaw',
          image: 'ghcr.io/openclaw/openclaw',
          version: '2026.4.12',
          arches: ['amd64'],
        },
        {
          name: 'claude-code',
          image: 'ghcr.io/example/claude-code',
          version: '1.2.3',
          arches: ['arm64'],
          publishAs: 'claude',
        },
      ],
    })

    const config = await readAgentsConfig(path)
    expect(expandMatrix(config, { agent: 'claude-code' })).toEqual([
      {
        agent: 'claude-code',
        image: 'ghcr.io/example/claude-code',
        version: '1.2.3',
        arch: 'arm64',
        publishAs: 'claude',
      },
    ])
  })

  it('rejects duplicate agent names', async () => {
    const path = await writeTempConfig({
      schema: 'v1',
      agents: [
        {
          name: 'openclaw',
          image: 'ghcr.io/openclaw/openclaw',
          version: '2026.4.12',
          arches: ['amd64'],
        },
        {
          name: 'openclaw',
          image: 'ghcr.io/example/openclaw',
          version: '2026.4.13',
          arches: ['arm64'],
        },
      ],
    })

    await expect(readAgentsConfig(path)).rejects.toThrow('duplicate agent name')
  })
})
