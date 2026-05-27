import { describe, expect, it } from 'bun:test'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { routeHomeSend } from './home-compose.helpers'

const llm: Provider = {
  id: 'browseros',
  name: 'BrowserOS',
  type: 'browseros',
  kind: 'llm',
}
const acp: Provider = {
  id: 'agent-1',
  name: 'Review bot',
  type: 'acp',
  kind: 'acp',
  agentId: 'agent-1',
}

describe('routeHomeSend', () => {
  it('routes an LLM provider to the in-tab provider chat', () => {
    expect(routeHomeSend(llm, 'hello')).toEqual({
      kind: 'llm',
      providerId: 'browseros',
      path: '/home/chat?q=hello',
    })
  })

  it('routes a named agent to its harness conversation', () => {
    expect(routeHomeSend(acp, 'do a thing')).toEqual({
      kind: 'acp',
      agentId: 'agent-1',
      path: '/home/agents/agent-1?q=do%20a%20thing',
    })
  })

  it('encodes special characters in the query', () => {
    expect(routeHomeSend(llm, 'a & b?')?.path).toBe(
      '/home/chat?q=a%20%26%20b%3F',
    )
  })

  it('returns null for an empty prompt', () => {
    expect(routeHomeSend(llm, '   ')).toBeNull()
  })
})
