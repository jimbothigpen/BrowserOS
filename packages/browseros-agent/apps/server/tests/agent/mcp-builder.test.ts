import { describe, expect, it } from 'bun:test'
import { BrowserContextSchema } from '@browseros/shared/schemas/browser-context'
import { buildMcpServerSpecs } from '../../src/agent/mcp-builder'

describe('MCP builder custom process servers', () => {
  it('accepts stdio process MCP servers in browser context', () => {
    const parsed = BrowserContextSchema.safeParse({
      customMcpServers: [
        {
          name: 'AnythingLLM',
          type: 'process',
          command: 'npx',
          args: ['-y', 'anythingllm-mcp-server@2.0.0'],
          env: {
            ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
            ANYTHINGLLM_API_KEY: 'test-key',
          },
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects process MCP servers without a command', () => {
    const parsed = BrowserContextSchema.safeParse({
      customMcpServers: [
        {
          name: 'AnythingLLM',
          type: 'process',
          env: {
            ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
          },
        },
      ],
    })

    expect(parsed.success).toBe(false)
  })

  it('builds process MCP specs without probing HTTP transport', async () => {
    const specs = await buildMcpServerSpecs({
      browserContext: {
        customMcpServers: [
          {
            name: 'AnythingLLM',
            type: 'process',
            command: 'npx',
            args: ['-y', 'anythingllm-mcp-server@2.0.0'],
            env: {
              ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
              ANYTHINGLLM_API_KEY: 'test-key',
            },
            cwd: '/tmp',
          },
        ],
      },
    })

    expect(specs).toEqual([
      {
        name: 'custom-AnythingLLM',
        type: 'process',
        command: 'npx',
        args: ['-y', 'anythingllm-mcp-server@2.0.0'],
        env: {
          ANYTHINGLLM_BASE_URL: 'http://localhost:3001',
          ANYTHINGLLM_API_KEY: 'test-key',
        },
        cwd: '/tmp',
      },
    ])
  })
})
