import { afterEach, beforeEach, describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser } from '../../src/browser/browser'
import { executeTool } from '../../src/tools/framework'
import { click } from '../../src/tools/input'

const originalFetch = globalThis.fetch
const originalMolmoPointUrl = process.env.BROWSEROS_MOLMOPOINT_URL

describe('MolmoPoint click marker', () => {
  beforeEach(() => {
    process.env.BROWSEROS_MOLMOPOINT_URL = 'https://molmo.test'
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          points: [{ object_id: 0, image_num: 0, x: 200, y: 100 }],
          text: '<point x="200" y="100"></point>',
          image_size: [400, 300],
        }),
        { headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalMolmoPointUrl === undefined) {
      delete process.env.BROWSEROS_MOLMOPOINT_URL
    } else {
      process.env.BROWSEROS_MOLMOPOINT_URL = originalMolmoPointUrl
    }
  })

  it('shows an aim marker before dispatching the click', async () => {
    const events: Array<{ name: 'marker' | 'click'; time: number }> = []
    let markerExpression = ''

    const browser = {
      screenshot: async () => ({
        data: 'fake-image',
        mimeType: 'image/png',
        devicePixelRatio: 2,
      }),
      evaluate: async (_page: number, expression: string) => {
        events.push({ name: 'marker', time: performance.now() })
        markerExpression = expression
        return { value: null }
      },
      clickAt: async (_page: number, x: number, y: number) => {
        events.push({ name: 'click', time: performance.now() })
        assert.strictEqual(x, 100)
        assert.strictEqual(y, 50)
      },
      snapshot: async () => '',
      getTabIdForPage: () => undefined,
    } as unknown as Browser

    const result = await executeTool(
      click,
      { page: 1, target: 'the Submit button' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(5_000),
    )

    assert.ok(!result.isError, JSON.stringify(result.content))
    assert.match(markerExpression, /__molmo_click_aim/)
    const markerEvent = events.find((event) => event.name === 'marker')
    const clickEvent = events.find((event) => event.name === 'click')
    assert.ok(markerEvent, 'expected marker to be shown')
    assert.ok(clickEvent, 'expected click to be dispatched')
    assert.ok(
      clickEvent.time - markerEvent.time >= 200,
      'expected marker to remain visible briefly before click dispatch',
    )
  })
})
