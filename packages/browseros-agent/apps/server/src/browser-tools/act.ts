import { z } from 'zod'
import type { BrowserSession } from '../browser/core/session'
import {
  defineTool,
  errorResult,
  type ToolResult,
  textResult,
} from './framework'
import { wrapUntrusted } from './trust-boundary'

type InputApi = ReturnType<BrowserSession['input']>

// Flat (not discriminated-union) schema: some providers reject nested anyOf JSON Schema. The kind
// is validated at runtime in the handler. All page mutation goes through this one tool.
export const act = defineTool({
  name: 'act',
  description:
    'Act on the page using refs from the last snapshot. kinds: click, type (into focused element), fill (one field via ref+value, or many via fields[]), press (a key/combo), hover, select (an option value), scroll. Reads back a diff of what changed - re-snapshot if you need fresh refs.',
  input: z.object({
    page: z.number().int(),
    kind: z.enum([
      'click',
      'type',
      'fill',
      'press',
      'hover',
      'select',
      'scroll',
    ]),
    ref: z.string().optional().describe('Target element ref, e.g. "e12".'),
    text: z.string().optional().describe('Text for kind=type.'),
    value: z.string().optional().describe('Value for kind=fill/select.'),
    fields: z
      .array(z.object({ ref: z.string(), value: z.string() }))
      .optional()
      .describe('Multiple fields for kind=fill, filled in order.'),
    key: z
      .string()
      .optional()
      .describe('Key/combo for kind=press, e.g. "Enter", "Control+a".'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    amount: z
      .number()
      .optional()
      .describe('Scroll amount (wheel notches), default 3.'),
    button: z.enum(['left', 'middle', 'right']).optional(),
  }),
  handler: async (args, ctx) => {
    const input = ctx.session.input(args.page)

    const err = await runKind(args, input)
    if (err) return err

    const diff = await ctx.session.observe(args.page).diff()
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    const body = diff.changed
      ? `page changed:\n${wrapUntrusted(diff.text, origin)}`
      : 'no visible change'
    return textResult(`ok (${args.kind}) · ${body}`, {
      kind: args.kind,
      changed: diff.changed,
    })
  },
})

type ActArgs = {
  kind: string
  ref?: string
  text?: string
  value?: string
  fields?: { ref: string; value: string }[]
  key?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  button?: 'left' | 'middle' | 'right'
}

// Returns an error result when required args are missing, else undefined after acting.
async function runKind(
  args: ActArgs,
  input: InputApi,
): Promise<ToolResult | undefined> {
  switch (args.kind) {
    case 'click':
      if (!args.ref) return errorResult('act click: ref is required.')
      await input.click(args.ref, args.button ? { button: args.button } : {})
      return undefined
    case 'type':
      if (args.text === undefined)
        return errorResult('act type: text is required.')
      await input.type(args.text)
      return undefined
    case 'fill':
      if (args.fields) {
        for (const field of args.fields)
          await input.fill(field.ref, field.value)
        return undefined
      }
      if (args.ref && args.value !== undefined) {
        await input.fill(args.ref, args.value)
        return undefined
      }
      return errorResult('act fill: provide fields[] or both ref and value.')
    case 'press':
      if (!args.key) return errorResult('act press: key is required.')
      await input.press(args.key)
      return undefined
    case 'hover':
      if (!args.ref) return errorResult('act hover: ref is required.')
      await input.hover(args.ref)
      return undefined
    case 'select':
      if (!args.ref || args.value === undefined) {
        return errorResult('act select: ref and value are required.')
      }
      await input.selectOption(args.ref, args.value)
      return undefined
    case 'scroll':
      await input.scroll(args.direction ?? 'down', args.amount ?? 3, args.ref)
      return undefined
    default:
      return errorResult(`act: unknown kind "${args.kind}".`)
  }
}
