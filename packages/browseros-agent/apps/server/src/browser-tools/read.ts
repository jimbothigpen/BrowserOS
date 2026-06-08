import { z } from 'zod'
import { buildContentMarkdownExpression } from '../browser/content-markdown'
import { defineTool, textResult } from './framework'
import { wrapUntrusted } from './trust-boundary'

function expressionFor(
  format: 'markdown' | 'text' | 'links',
  selector?: string,
): string {
  if (format === 'markdown') return buildContentMarkdownExpression({ selector })
  const root = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : 'document.body'
  if (format === 'text') return `((${root})?.innerText ?? '')`
  return `[...(${root}?.querySelectorAll('a[href]') ?? [])].map(function(a){return '[' + (a.textContent||'').trim() + '](' + a.href + ')'}).join('\\n')`
}

export const read = defineTool({
  name: 'read',
  description:
    'Extract page content as markdown (default), plain text, or a list of links. For reading/scraping, not acting.',
  input: z.object({
    page: z.number().int(),
    format: z.enum(['markdown', 'text', 'links']).default('markdown'),
    selector: z.string().optional().describe('Restrict to a CSS subtree.'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const result = await session.Runtime.evaluate({
      expression: expressionFor(args.format, args.selector),
      returnByValue: true,
    })
    const text = (result.result?.value as string) ?? ''
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return textResult(wrapUntrusted(text || '(empty)', origin), {
      page: args.page,
      format: args.format,
    })
  },
})
