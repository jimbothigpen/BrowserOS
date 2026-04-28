import { useQuery } from '@tanstack/react-query'
import type { HarnessAgentHistoryPage } from '@/entrypoints/app/agents/agent-harness-types'
import { fetchHarnessAgentHistory } from '@/entrypoints/app/agents/useAgents'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import type {
  AgentHistoryPageResponse,
  BrowserOSChatHistoryItem,
} from './claw-chat-types'

const HISTORY_QUERY_KEY = 'harness-agent-history'

export function useHarnessChatHistory(agentId: string, enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentHistoryPageResponse, Error>({
    queryKey: [HISTORY_QUERY_KEY, baseUrl, agentId, 'main'],
    queryFn: async () => {
      return mapHarnessHistoryPage(await fetchHarnessAgentHistory(agentId))
    },
    enabled: Boolean(baseUrl) && !urlLoading && enabled && Boolean(agentId),
  })

  return {
    ...query,
    error: query.error ?? urlError,
    isLoading: query.isLoading || urlLoading,
  }
}

function mapHarnessHistoryPage(
  page: HarnessAgentHistoryPage,
): AgentHistoryPageResponse {
  const items: BrowserOSChatHistoryItem[] = page.items.map((item, index) => ({
    id: item.id,
    role: item.role,
    text: item.text,
    timestamp: item.createdAt,
    messageSeq: index + 1,
    sessionKey: 'main',
    source: 'user-chat',
  }))
  const updatedAt =
    page.items.length > 0
      ? Math.max(...page.items.map((item) => item.createdAt))
      : Date.now()

  return {
    agentId: page.agentId,
    sessionKey: 'main',
    session: {
      key: 'main',
      updatedAt,
      sessionId: 'main',
      agentId: page.agentId,
      kind: 'agent-harness',
      source: 'user-chat',
    },
    items,
    page: {
      hasMore: false,
      limit: items.length,
    },
  }
}
