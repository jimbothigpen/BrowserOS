import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '../../src/browser/core/session'
import { registerBrowserTools } from '../../src/browser-tools/register'
import { BROWSER_TOOLS } from '../../src/browser-tools/registry'

type RegisteredHandler = (args: Record<string, unknown>) => Promise<{
  content: unknown
  isError?: boolean
  structuredContent?: unknown
}>

function createFakeServer() {
  const handlers = new Map<string, RegisteredHandler>()
  const configs = new Map<
    string,
    { description: string; inputSchema?: unknown }
  >()

  return {
    handlers,
    configs,
    server: {
      registerTool(
        name: string,
        config: { description: string; inputSchema?: unknown },
        handler: RegisteredHandler,
      ) {
        configs.set(name, config)
        handlers.set(name, handler)
      },
    },
  }
}

describe('registerBrowserTools', () => {
  it('registers the compact browser tool surface', () => {
    const fake = createFakeServer()
    const session = { pages: {} } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session)

    expect([...fake.handlers.keys()]).toEqual(BROWSER_TOOLS.map((t) => t.name))
    expect(fake.handlers.size).toBe(10)
    expect(fake.configs.get('tabs')?.inputSchema).toBeDefined()
  })

  it('applies scoped defaults when opening a new tab', async () => {
    const fake = createFakeServer()
    const calls: Array<{
      url: string
      opts?: { windowId?: number; tabGroupId?: string }
    }> = []
    const session = {
      pages: {
        newPage: async (
          url: string,
          opts?: { windowId?: number; tabGroupId?: string },
        ) => {
          calls.push({ url, opts })
          return 42
        },
      },
    } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session, {
      defaultWindowId: 7,
      defaultTabGroupId: 'group-a',
    })

    const result = await fake.handlers.get('tabs')?.({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toEqual({ page: 42 })
    expect(calls).toEqual([
      {
        url: 'https://example.com',
        opts: { windowId: 7, tabGroupId: 'group-a' },
      },
    ])
  })
})
