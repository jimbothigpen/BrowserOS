import { describe, expect, it } from 'bun:test'
import { buildChatCustomMcpServers } from './customMcpServerPayload'

describe('buildChatCustomMcpServers', () => {
  it('keeps existing URL-only custom MCP servers backward compatible', () => {
    const servers = buildChatCustomMcpServers([
      {
        id: 'custom-http',
        displayName: 'Custom HTTP',
        type: 'custom',
        config: {
          url: 'http://127.0.0.1:19002/mcp',
        },
      },
    ])

    expect(servers).toEqual([
      {
        name: 'Custom HTTP',
        type: 'http',
        url: 'http://127.0.0.1:19002/mcp',
        headers: undefined,
      },
    ])
  })

  it('maps process MCP servers into chat browser context', () => {
    const servers = buildChatCustomMcpServers([
      {
        id: 'anythingllm',
        displayName: 'AnythingLLM',
        type: 'custom',
        config: {
          type: 'process',
          command: 'npx',
          args: ['-y', 'anythingllm-mcp-server@2.0.0'],
          env: {
            ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
            ANYTHINGLLM_API_KEY: 'test-key',
          },
        },
      },
    ])

    expect(servers).toEqual([
      {
        name: 'AnythingLLM',
        type: 'process',
        command: 'npx',
        args: ['-y', 'anythingllm-mcp-server@2.0.0'],
        env: {
          ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
          ANYTHINGLLM_API_KEY: 'test-key',
        },
        cwd: undefined,
      },
    ])
  })
})
