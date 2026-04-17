import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import type { OpenClawAgentEntry } from '../openclaw/openclaw-service'
import type { AgentRegistryService } from './agent-registry-service'

interface OpenClawServiceLike {
  getStatus(): Promise<{
    status: string
    controlPlaneStatus: string
  }>
  listAgents(): Promise<OpenClawAgentEntry[]>
}

export async function importOpenClawAgentsIntoRegistry(input: {
  registry: AgentRegistryService
  openClawService: OpenClawServiceLike
  agentId?: string
}): Promise<BrowserOsStoredAgent[]> {
  const status = await input.openClawService.getStatus()
  if (
    status.status !== 'running' ||
    status.controlPlaneStatus !== 'connected'
  ) {
    return []
  }

  const existingAgents = await input.registry.list()
  const existingIds = new Set(
    existingAgents
      .filter((agent) => agent.adapterType === 'openclaw')
      .map((agent) => agent.id),
  )

  const openClawAgents = await input.openClawService.listAgents()
  const importedAgents: BrowserOsStoredAgent[] = []

  for (const agent of openClawAgents) {
    if (input.agentId && agent.agentId !== input.agentId) {
      continue
    }
    if (existingIds.has(agent.agentId)) {
      continue
    }

    const imported = await input.registry.create({
      id: agent.agentId,
      name: agent.name,
      adapterType: 'openclaw',
      runtimeBinding: {
        agentId: agent.agentId,
        workspace: agent.workspace,
        model: agent.model,
      },
    })
    existingIds.add(agent.agentId)
    importedAgents.push(imported)
  }

  return importedAgents
}
