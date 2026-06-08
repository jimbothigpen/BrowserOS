import { z } from 'zod'
import { defineTool, errorResult, textResult } from './framework'

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const wait = defineTool({
  name: 'wait',
  description:
    'Wait for a condition before continuing. Prefer acting directly and reading the diff; use wait only when there is no reliable UI signal yet. for="text" (substring appears), "selector" (element appears), or "time" (value = ms).',
  input: z.object({
    page: z.number().int(),
    for: z.enum(['text', 'selector', 'time']),
    value: z
      .string()
      .optional()
      .describe('Text/selector, or ms for for="time".'),
    timeout: z.number().optional().describe('Max wait in ms (default 10000).'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const timeout = args.timeout ?? 10_000

    if (args.for === 'time') {
      await delay(Number(args.value ?? timeout))
      return textResult('waited', { matched: true })
    }
    if (!args.value) {
      return errorResult(`wait: value is required for for="${args.for}".`)
    }

    const { session } = await ctx.session.pages.getSession(args.page)
    const expression =
      args.for === 'text'
        ? `(document.body?.innerText ?? '').includes(${JSON.stringify(args.value)})`
        : `!!document.querySelector(${JSON.stringify(args.value)})`

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const result = await session.Runtime.evaluate({
        expression,
        returnByValue: true,
      })
      if (result.result?.value === true) {
        return textResult(`matched (${args.for})`, { matched: true })
      }
      await delay(300)
    }
    return textResult(`timed out after ${timeout}ms waiting for ${args.for}`, {
      matched: false,
    })
  },
})
