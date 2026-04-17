import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type {
  BrowserOsAgentAdapterType,
  BrowserOsStoredAgent,
  BrowserOsValidationState,
} from '@browseros/shared/types/browseros-agents'
import type {
  BrowserOSAgentRoleId,
  BrowserOSAgentRoleSummary,
  BrowserOSCustomRoleInput,
} from '@browseros/shared/types/role-aware-agents'
import {
  ensureBrowserosDir,
  getAgentDir,
  getAgentMetadataPath,
  getAgentRuntimeDir,
  getAgentsDir,
} from '../../../lib/browseros-dir'
import { buildAgentBootstrapFiles } from './agent-bootstrap'
import { resolveRoleTemplate, toRoleSummary } from './role-metadata'

export interface CreateAgentRegistryInput {
  id: string
  name: string
  adapterType: BrowserOsAgentAdapterType
  adapterConfig?: Record<string, unknown>
  runtimeBinding?: Record<string, unknown> | null
  lastValidation?: BrowserOsValidationState | null
  roleId?: BrowserOSAgentRoleId
  customRole?: BrowserOSCustomRoleInput
  roleSummary?: BrowserOSAgentRoleSummary
}

export class AgentRegistryService {
  async list(): Promise<BrowserOsStoredAgent[]> {
    await ensureBrowserosDir()

    const entries = await readdir(getAgentsDir(), { withFileTypes: true })
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.get(entry.name)),
    )

    return records
      .filter((record): record is BrowserOsStoredAgent => record !== null)
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  async get(agentId: string): Promise<BrowserOsStoredAgent | null> {
    this.assertValidAgentId(agentId)

    try {
      const raw = await readFile(getAgentMetadataPath(agentId), 'utf8')
      return JSON.parse(raw) as BrowserOsStoredAgent
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async create(input: CreateAgentRegistryInput): Promise<BrowserOsStoredAgent> {
    this.assertValidAgentId(input.id)

    if (await this.get(input.id)) {
      throw new Error(`Agent "${input.id}" already exists`)
    }

    const now = new Date().toISOString()
    const agentDir = getAgentDir(input.id)
    const record: BrowserOsStoredAgent = {
      version: 1,
      id: input.id,
      name: input.name,
      adapterType: input.adapterType,
      role: this.resolveRoleSummary(input),
      paths: {
        agentDir,
        cwd: agentDir,
        contextDirs: [],
      },
      adapterConfig: input.adapterConfig ?? {},
      runtimeBinding: input.runtimeBinding ?? null,
      lastValidation: input.lastValidation ?? null,
      createdAt: now,
      updatedAt: now,
    }

    await ensureBrowserosDir()
    await mkdir(agentDir, { recursive: true })
    await this.writeBootstrapFiles(input)
    await mkdir(getAgentRuntimeDir(input.id), { recursive: true })
    await this.writeRecord(record)

    return record
  }

  async update(record: BrowserOsStoredAgent): Promise<BrowserOsStoredAgent> {
    this.assertValidAgentId(record.id)

    const agentDir = getAgentDir(record.id)
    const updatedRecord: BrowserOsStoredAgent = {
      ...record,
      version: 1,
      paths: {
        agentDir,
        cwd: record.paths.cwd,
        contextDirs: record.paths.contextDirs ?? [],
      },
      updatedAt: new Date().toISOString(),
    }

    await ensureBrowserosDir()
    await mkdir(agentDir, { recursive: true })
    await mkdir(getAgentRuntimeDir(record.id), { recursive: true })
    await this.writeRecord(updatedRecord)

    return updatedRecord
  }

  async remove(agentId: string): Promise<void> {
    this.assertValidAgentId(agentId)
    await rm(getAgentDir(agentId), { recursive: true, force: true })
  }

  private resolveRoleSummary(
    input: CreateAgentRegistryInput,
  ): BrowserOSAgentRoleSummary | undefined {
    if (
      Number(Boolean(input.roleId)) +
        Number(Boolean(input.customRole)) +
        Number(Boolean(input.roleSummary)) >
      1
    ) {
      throw new Error(
        'Specify only one of roleId, customRole, or roleSummary when creating.',
      )
    }

    if (input.roleId) {
      return toRoleSummary(resolveRoleTemplate(input.roleId))
    }

    if (input.customRole) {
      return toRoleSummary(input.customRole)
    }

    if (input.roleSummary) {
      return input.roleSummary
    }

    return undefined
  }

  private async writeBootstrapFiles(
    input: CreateAgentRegistryInput,
  ): Promise<void> {
    const files = buildAgentBootstrapFiles({
      agentName: input.name,
    })
    const agentDir = getAgentDir(input.id)

    await Promise.all(
      Object.entries(files).map(([fileName, content]) =>
        writeFile(resolve(agentDir, fileName), content, 'utf8'),
      ),
    )
  }

  private async writeRecord(record: BrowserOsStoredAgent): Promise<void> {
    await writeFile(
      getAgentMetadataPath(record.id),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    )
  }

  private assertValidAgentId(agentId: string): void {
    if (!agentId || agentId.includes('/') || agentId.includes('\\')) {
      throw new Error('Invalid agent id')
    }

    const agentsDir = getAgentsDir()
    const resolved = resolve(agentsDir, agentId)
    if (resolved !== getAgentDir(agentId)) {
      throw new Error('Invalid agent id')
    }
    if (!resolved.startsWith(`${agentsDir}${sep}`)) {
      throw new Error('Invalid agent id')
    }
  }
}
