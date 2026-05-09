import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser } from '../../src/browser/browser'
import { executeTool, type ToolContext } from '../../src/tools/framework'
import { wait_for } from '../../src/tools/navigation'
import { registry } from '../../src/tools/registry'
import { browser_run_code } from '../../src/tools/snapshot'

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function structuredOf<T>(result: { structuredContent?: unknown }): T {
  assert.ok(result.structuredContent, 'Expected structuredContent')
  return result.structuredContent as T
}

function createToolContext(methods: Record<string, unknown>): ToolContext {
  return {
    browser: {
      getTabIdForPage: () => undefined,
      snapshot: async () => '',
      ...methods,
    } as unknown as Browser,
    directories: { workingDir: process.cwd() },
  }
}

describe('tool registry', () => {
  it('exposes wait and custom code tools to MCP clients', () => {
    assert.ok(registry.get('wait_for'), 'Expected wait_for to be registered')
    assert.ok(
      registry.get('browser_run_code'),
      'Expected browser_run_code to be registered',
    )
  })

  it('wait_for supports fixed delays without a browser call', async () => {
    let waitForCalled = false
    const start = Date.now()
    const result = await executeTool(
      wait_for,
      { page: 1, time: 10 },
      createToolContext({
        waitFor: async () => {
          waitForCalled = true
          return false
        },
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(!result.isError, textOf(result))
    assert.ok(Date.now() - start >= 8, 'Expected wait_for to delay')
    assert.strictEqual(waitForCalled, false)
    assert.deepStrictEqual(structuredOf(result), {
      page: 1,
      found: true,
      target: '10ms',
      timeout: 10,
    })
  })

  it('wait_for rejects combined time and page conditions', async () => {
    let waitForCalled = false
    const result = await executeTool(
      wait_for,
      { page: 7, text: 'Ready', time: 100 },
      createToolContext({
        waitFor: async () => {
          waitForCalled = true
          return true
        },
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(result.isError, 'Expected wait_for to reject mixed conditions')
    assert.strictEqual(waitForCalled, false)
    assert.ok(textOf(result).includes('Provide exactly one wait condition'))
  })

  it('wait_for rejects multiple page conditions', async () => {
    const result = await executeTool(
      wait_for,
      { page: 7, textGone: 'Loading', selectorGone: '.spinner' },
      createToolContext({
        waitFor: async () => true,
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(result.isError, 'Expected wait_for to reject ambiguous waits')
    assert.ok(textOf(result).includes('Provide exactly one wait condition'))
  })

  it('wait_for forwards disappearance conditions to the browser', async () => {
    const calls: unknown[] = []
    const result = await executeTool(
      wait_for,
      { page: 7, selectorGone: '.spinner' },
      createToolContext({
        waitFor: async (_page: number, opts: unknown) => {
          calls.push(opts)
          return true
        },
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(!result.isError, textOf(result))
    assert.deepStrictEqual(calls, [
      {
        text: undefined,
        textGone: undefined,
        selector: undefined,
        selectorGone: '.spinner',
        timeout: 10_000,
      },
    ])
    const data = structuredOf<{
      page: number
      found: boolean
      target: string
      timeout: number
    }>(result)
    assert.strictEqual(data.page, 7)
    assert.strictEqual(data.found, true)
    assert.strictEqual(data.target, 'selector ".spinner" to disappear')
    assert.strictEqual(data.timeout, 10_000)
  })

  it('browser_run_code returns successful values', async () => {
    const result = await executeTool(
      browser_run_code,
      { page: 2, code: 'return args.value', args: { value: 42 } },
      createToolContext({
        runCode: async (
          page: number,
          code: string,
          args?: Record<string, unknown>,
        ) => ({
          value: { page, code, args },
        }),
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(!result.isError, textOf(result))
    assert.deepStrictEqual(structuredOf(result).value, {
      page: 2,
      code: 'return args.value',
      args: { value: 42 },
    })
  })

  it('browser_run_code reports code errors', async () => {
    const result = await executeTool(
      browser_run_code,
      { page: 2, code: 'throw new Error("boom")' },
      createToolContext({
        runCode: async () => ({ error: 'Error: boom' }),
      }),
      AbortSignal.timeout(1_000),
    )

    assert.ok(result.isError, 'Expected browser_run_code to fail')
    assert.ok(textOf(result).includes('Error: boom'))
  })
})
