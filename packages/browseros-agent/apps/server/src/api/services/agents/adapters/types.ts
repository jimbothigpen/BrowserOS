import type { UIMessageStreamEvent } from '@browseros/shared/schemas/ui-stream'
import type {
  BrowserOsAgentAdapterType,
  BrowserOsStoredAgent,
} from '@browseros/shared/types/browseros-agents'
import type {
  BrowserOSAgentRoleId,
  BrowserOSCustomRoleInput,
} from '@browseros/shared/types/role-aware-agents'

export interface BrowserOsAgentCreateInput {
  id: string
  name: string
  adapterType: BrowserOsAgentAdapterType
  binaryPath?: string
  roleId?: BrowserOSAgentRoleId
  customRole?: BrowserOSCustomRoleInput
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface BrowserOsAgentMaterializationResult {
  runtimeBinding: Record<string, unknown> | null
  adapterConfig?: Record<string, unknown>
}

export interface BrowserOsAgentChatInput {
  sessionKey: string
  message: string
  conversation?: BrowserOsAgentConversationTurn[]
}

export interface BrowserOsAgentConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface BrowserOsAgentCatalogEntry {
  adapterType: BrowserOsAgentAdapterType
  label: string
}

export interface BrowserOsAgentAdapter {
  readonly adapterType: BrowserOsAgentAdapterType
  validateCreate(input: BrowserOsAgentCreateInput): Promise<void>
  materialize(
    input: BrowserOsAgentCreateInput,
  ): Promise<BrowserOsAgentMaterializationResult>
  remove(record: BrowserOsStoredAgent): Promise<void>
  streamChat(
    record: BrowserOsStoredAgent,
    input: BrowserOsAgentChatInput,
  ): Promise<ReadableStream<UIMessageStreamEvent>>
}
