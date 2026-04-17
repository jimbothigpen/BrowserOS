import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserOsStoredAgent } from '@browseros/shared/types/browseros-agents'
import type { BrowserOsAgentConversationTurn } from './types'

export interface LocalPromptInput {
  message: string
  conversation?: BrowserOsAgentConversationTurn[]
}

export async function buildLocalAgentPrompt(
  record: BrowserOsStoredAgent,
  input: LocalPromptInput,
): Promise<string> {
  const [agentsMd, soulMd, toolsMd] = await Promise.all([
    readAgentFile(record, 'AGENTS.md'),
    readAgentFile(record, 'SOUL.md'),
    readAgentFile(record, 'TOOLS.md'),
  ])

  return [
    '# BrowserOS Local Agent Prompt',
    '',
    '## AGENTS.md',
    agentsMd.trim(),
    '',
    '## SOUL.md',
    soulMd.trim(),
    '',
    '## TOOLS.md',
    toolsMd.trim(),
    '',
    '## Recent Conversation',
    renderRecentConversation(input.conversation ?? []),
    '',
    '## Latest User Message',
    input.message,
    '',
    'Respond with the best possible answer for the latest user message.',
    '',
  ].join('\n')
}

async function readAgentFile(
  record: BrowserOsStoredAgent,
  fileName: string,
): Promise<string> {
  return readFile(join(record.paths.agentDir, fileName), 'utf8')
}

function renderRecentConversation(
  messages: BrowserOsAgentConversationTurn[],
): string {
  if (messages.length === 0) {
    return 'None.'
  }

  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join('\n')
}
