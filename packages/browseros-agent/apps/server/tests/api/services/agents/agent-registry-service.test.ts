/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'

describe('AgentRegistryService', () => {
  let homeDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'browseros-agent-registry-'))
    mock.module('node:os', () => ({
      homedir: () => homeDir,
    }))
  })

  afterEach(async () => {
    mock.restore()
    await rm(homeDir, { recursive: true, force: true })
  })

  it('creates a managed agent directory with metadata, bootstrap files, and runtime state', async () => {
    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )

    const service = new AgentRegistryService()
    const created = await service.create({
      id: 'chief-of-staff',
      name: 'Chief of Staff',
      adapterType: 'openclaw',
      adapterConfig: {
        providerName: 'openclaw',
      },
      roleId: 'chief-of-staff',
    })

    const agentDir = join(homeDir, '.browseros', 'agents', 'chief-of-staff')
    const metadataPath = join(agentDir, 'agent.json')
    const runtimePath = join(agentDir, 'runtime')
    const agentsMdPath = join(agentDir, 'AGENTS.md')
    const soulMdPath = join(agentDir, 'SOUL.md')
    const toolsMdPath = join(agentDir, 'TOOLS.md')
    const heartbeatMdPath = join(agentDir, 'HEARTBEAT.md')

    expect(created).toMatchObject({
      version: 1,
      id: 'chief-of-staff',
      name: 'Chief of Staff',
      adapterType: 'openclaw',
      role: {
        roleSource: 'builtin',
        roleId: 'chief-of-staff',
        roleName: 'Chief of Staff',
      },
      paths: {
        agentDir,
        cwd: agentDir,
        contextDirs: [],
      },
      adapterConfig: {
        providerName: 'openclaw',
      },
      runtimeBinding: null,
      lastValidation: null,
    })

    const stored = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as BrowserOsStoredAgent
    expect(stored).toEqual(created)
    expect((await readFile(metadataPath, 'utf8')).endsWith('\n')).toBe(true)

    expect(await readFile(agentsMdPath, 'utf8')).toContain(
      'You are a BrowserOS-managed agent for this workspace.',
    )
    expect(await readFile(soulMdPath, 'utf8')).toContain(
      'You act like a reliable BrowserOS operator.',
    )
    expect(await readFile(toolsMdPath, 'utf8')).toContain('browseros-cli')
    expect(await readFile(heartbeatMdPath, 'utf8')).toContain(
      'reserved for future autonomous wake/schedule behavior',
    )
    expect(await readFile(heartbeatMdPath, 'utf8')).toContain(
      'unused in v1 chats',
    )

    const runtimeStats = await stat(runtimePath)
    expect(runtimeStats.isDirectory()).toBe(true)
  })

  it('preserves a custom cwd and contextDirs when updating an existing record', async () => {
    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )

    const service = new AgentRegistryService()
    const created = await service.create({
      id: 'ops',
      name: 'Ops',
      adapterType: 'openclaw',
    })

    const customCwd = join(homeDir, 'workspace', 'ops')
    const updated = await service.update({
      ...created,
      paths: {
        ...created.paths,
        cwd: customCwd,
        contextDirs: [join(homeDir, 'contexts', 'shared')],
      },
    })

    expect(updated.paths).toEqual({
      agentDir: created.paths.agentDir,
      cwd: customCwd,
      contextDirs: [join(homeDir, 'contexts', 'shared')],
    })

    const reloaded = await service.get('ops')
    expect(reloaded?.paths).toEqual({
      agentDir: created.paths.agentDir,
      cwd: customCwd,
      contextDirs: [join(homeDir, 'contexts', 'shared')],
    })
  })

  it('stores imported custom-role summaries without changing bootstrap files', async () => {
    const { AgentRegistryService } = await import(
      '../../../../src/api/services/agents/agent-registry-service'
    )

    const service = new AgentRegistryService()
    const created = await service.create({
      id: 'board-ops',
      name: 'Board Ops',
      adapterType: 'openclaw',
      roleSummary: {
        roleSource: 'custom',
        roleName: 'Board Prep Operator',
        shortDescription:
          'Prepares executive briefs and weekly board follow-ups.',
      },
    })

    expect(created.role).toEqual({
      roleSource: 'custom',
      roleName: 'Board Prep Operator',
      shortDescription:
        'Prepares executive briefs and weekly board follow-ups.',
    })

    const agentDir = join(homeDir, '.browseros', 'agents', 'board-ops')
    expect(await readFile(join(agentDir, 'AGENTS.md'), 'utf8')).toContain(
      'You are a BrowserOS-managed agent for this workspace.',
    )
    expect(await readFile(join(agentDir, 'SOUL.md'), 'utf8')).toContain(
      'You act like a reliable BrowserOS operator.',
    )
    expect(await readFile(join(agentDir, 'TOOLS.md'), 'utf8')).toContain(
      'browseros-cli',
    )
  })
})
