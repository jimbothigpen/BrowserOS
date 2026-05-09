import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { Browser } from '../../src/browser/browser'

function createBrowserWithSelectorPresence(values: boolean[]): Browser {
  const browser = Object.create(Browser.prototype) as Browser
  const session = {
    Runtime: {
      evaluate: async () => ({
        result: { value: values.shift() ?? false },
      }),
    },
  } as unknown as ProtocolApi

  Object.defineProperty(browser, 'resolveSession', {
    value: async () => session,
  })

  return browser
}

describe('Browser.waitFor', () => {
  it('does not treat a selector that never existed as gone', async () => {
    const browser = createBrowserWithSelectorPresence([false, false, false])

    const found = await browser.waitFor(1, {
      selectorGone: '.spinner',
      timeout: 10,
    })

    assert.strictEqual(found, false)
  })

  it('resolves selectorGone after the selector appears and then disappears', async () => {
    const browser = createBrowserWithSelectorPresence([true, false])
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void) => {
      callback()
      return undefined as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    try {
      const found = await browser.waitFor(1, {
        selectorGone: '.spinner',
        timeout: 50,
      })

      assert.strictEqual(found, true)
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
  })
})
