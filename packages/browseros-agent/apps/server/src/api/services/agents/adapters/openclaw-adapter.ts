import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import type { OpenClawAgentEntry } from '../../openclaw/openclaw-service'
import type { OpenClawStreamEvent } from '../../openclaw/openclaw-types'
import { normalizeOpenClawStream } from '../ui-stream'
import type {
  BrowserOsAgentAdapter,
  BrowserOsAgentChatInput,
  BrowserOsAgentCreateInput,
  BrowserOsAgentMaterializationResult,
} from './types'

interface OpenClawServiceLike {
  getStatus(): Promise<{
    status: string
    controlPlaneStatus: string
  }>
  createAgent(input: {
    name: string
    providerType?: string
    providerName?: string
    baseUrl?: string
    apiKey?: string
    modelId?: string
  }): Promise<OpenClawAgentEntry>
  removeAgent(agentId: string): Promise<void>
  chatStream(
    agentId: string,
    sessionKey: string,
    message: string,
  ): Promise<ReadableStream<OpenClawStreamEvent>>
}

export class OpenClawAgentAdapter implements BrowserOsAgentAdapter {
  readonly adapterType = 'openclaw' as const

  constructor(private readonly openClawService: OpenClawServiceLike) {}

  async validateCreate(input: BrowserOsAgentCreateInput): Promise<void> {
    if (input.adapterType !== this.adapterType) {
      throw new Error(`Unsupported adapter type: ${input.adapterType}`)
    }

    const status = await this.openClawService.getStatus()
    if (
      status.status !== 'running' ||
      status.controlPlaneStatus !== 'connected'
    ) {
      throw new Error(
        'OpenClaw must be running with a connected control plane before creating agents.',
      )
    }
  }

  async materialize(
    input: BrowserOsAgentCreateInput,
  ): Promise<BrowserOsAgentMaterializationResult> {
    const agent = await this.openClawService.createAgent({
      name: input.id,
      providerType: input.providerType,
      providerName: input.providerName,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      modelId: input.modelId,
    })

    return {
      runtimeBinding: toRuntimeBinding(agent),
      adapterConfig: toStoredAdapterConfig(input),
    }
  }

  async remove(record: BrowserOsStoredAgent): Promise<void> {
    await this.openClawService.removeAgent(resolveRuntimeAgentId(record))
  }

  async streamChat(
    record: BrowserOsStoredAgent,
    input: BrowserOsAgentChatInput,
  ): Promise<ReadableStream<UIMessageStreamEvent>> {
    const stream = await this.openClawService.chatStream(
      resolveRuntimeAgentId(record),
      input.sessionKey,
      input.message,
    )

    return normalizeOpenClawStream(stream, resolveRuntimeAgentId(record))
  }
}

function toRuntimeBinding(agent: OpenClawAgentEntry): Record<string, unknown> {
  return {
    agentId: agent.agentId,
    workspace: agent.workspace,
    model: agent.model,
  }
}

function toStoredAdapterConfig(
  input: BrowserOsAgentCreateInput,
): Record<string, unknown> {
  const config = {
    providerType: input.providerType,
    providerName: input.providerName,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
  }

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  )
}

function resolveRuntimeAgentId(record: BrowserOsStoredAgent): string {
  const runtimeAgentId = record.runtimeBinding?.agentId
  return typeof runtimeAgentId === 'string' && runtimeAgentId
    ? runtimeAgentId
    : record.id
}
