import { z } from 'zod'
import { logger } from '../lib/logger'
import { defineToolWithCategory, type ToolContext } from './framework'
import { type GuiHitElement, resolveGuiPoint } from './gui-click-resolver'
import type { ToolResponse } from './response'

const pageParam = z.number().describe('Page ID (from list_pages)')
const defineInputTool = defineToolWithCategory('input')
const elementParam = z
  .number()
  .describe('Element ID from snapshot (the number in [N])')
const guiHitElementOutput = z
  .object({
    tagName: z.string(),
    role: z.string().optional(),
    ariaLabel: z.string().optional(),
    labelText: z.string().optional(),
    textContent: z.string().optional(),
  })
  .nullable()

function quoteForAgent(value: string): string {
  return JSON.stringify(value)
}

function formatHitElementForAgent(hitElement: GuiHitElement | null): string {
  if (!hitElement) {
    return 'The click was successful, but no hit element could be resolved at the click point.'
  }

  const details = [`tagName=${quoteForAgent(hitElement.tagName)}`]
  if (hitElement.role) details.push(`role=${quoteForAgent(hitElement.role)}`)
  if (hitElement.ariaLabel) {
    details.push(`ariaLabel=${quoteForAgent(hitElement.ariaLabel)}`)
  }
  if (hitElement.labelText) {
    details.push(`labelText=${quoteForAgent(hitElement.labelText)}`)
  }
  if (hitElement.textContent) {
    details.push(`textContent=${quoteForAgent(hitElement.textContent)}`)
  }

  return `The click was successful and hit the element: ${details.join(', ')}.`
}

async function enforceAcl(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  response: ToolResponse,
): Promise<boolean> {
  if (!ctx.aclRules?.length) return false

  const { checkAcl } = await import('./acl/acl-guard')
  const check = await checkAcl(toolName, args, ctx.browser, ctx.aclRules)
  if (!check.blocked) return false

  const desc =
    check.rule?.description ??
    check.rule?.textMatch ??
    check.rule?.sitePattern ??
    'ACL rule'
  if (check.pageId !== undefined && check.elementId !== undefined) {
    await ctx.browser.highlightBlockedElement(
      check.pageId,
      check.elementId,
      desc,
    )
  }
  response.error(
    `Action blocked by ACL rule: "${desc}". The element on this page is restricted. Choose a different action or skip this step.`,
  )
  return true
}

export const click = defineInputTool({
  name: 'click',
  description:
    'Click a visible page target using the GUI click model. Provide a concise visual prompt for what to click.',
  input: z.object({
    page: pageParam,
    prompt: z
      .string()
      .min(1)
      .describe('Visual click instruction, e.g. "click the search box"'),
    button: z
      .enum(['left', 'right', 'middle'])
      .default('left')
      .describe('Mouse button'),
    clickCount: z
      .number()
      .default(1)
      .describe('Number of clicks (2 for double-click)'),
  }),
  output: z.object({
    action: z.literal('click'),
    page: z.number(),
    prompt: z.string(),
    button: z.enum(['left', 'right', 'middle']),
    clickCount: z.number(),
    x: z.number(),
    y: z.number(),
    hitElement: guiHitElementOutput,
    guiPointDebug: z.record(z.unknown()).optional(),
  }),
  handler: async (args, ctx, response) => {
    const { x, y, hitElement, log } = await resolveGuiPoint(
      ctx,
      args.page,
      args.prompt,
    )
    const clickLog = {
      ...log,
      clickPoint: { x, y },
      button: args.button,
      clickCount: args.clickCount,
    }

    const blocked = await enforceAcl('click', { ...args, x, y }, ctx, response)
    if (blocked) {
      logger.info('GUI click blocked by ACL', clickLog)
      return
    }

    await ctx.browser.clickAt(args.page, x, y, {
      button: args.button,
      clickCount: args.clickCount,
    })
    response.text(formatHitElementForAgent(hitElement))
    response.data({
      action: 'click',
      page: args.page,
      prompt: args.prompt,
      button: args.button,
      clickCount: args.clickCount,
      x,
      y,
      hitElement,
      guiPointDebug: clickLog,
    })
  },
})

export const click_at = defineInputTool({
  name: 'click_at',
  description: 'Click at specific page coordinates',
  input: z.object({
    page: pageParam,
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    button: z
      .enum(['left', 'right', 'middle'])
      .default('left')
      .describe('Mouse button'),
    clickCount: z.number().default(1).describe('Number of clicks'),
  }),
  output: z.object({
    action: z.literal('click_at'),
    page: z.number(),
    x: z.number(),
    y: z.number(),
    button: z.enum(['left', 'right', 'middle']),
    clickCount: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.clickAt(args.page, args.x, args.y, {
      button: args.button,
      clickCount: args.clickCount,
    })
    response.text(`Clicked at (${args.x}, ${args.y})`)
    response.data({
      action: 'click_at',
      page: args.page,
      x: args.x,
      y: args.y,
      button: args.button,
      clickCount: args.clickCount,
    })
    response.includeSnapshot(args.page)
  },
})

export const hover_at = defineInputTool({
  name: 'hover_at',
  description: 'Hover at specific page coordinates',
  input: z.object({
    page: pageParam,
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.hoverAt(args.page, args.x, args.y)
    response.text(`Hovered at (${args.x}, ${args.y})`)
    response.includeSnapshot(args.page)
  },
})

export const type_at = defineInputTool({
  name: 'type_at',
  description:
    'Click at specific coordinates then type text. Use for typing into inputs at known positions.',
  input: z.object({
    page: pageParam,
    x: z.number().describe('X coordinate to click before typing'),
    y: z.number().describe('Y coordinate to click before typing'),
    text: z.string().describe('Text to type'),
    clear: z.boolean().default(false).describe('Clear field before typing'),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.typeAt(args.page, args.x, args.y, args.text, args.clear)
    response.text(`Typed ${args.text.length} chars at (${args.x}, ${args.y})`)
    response.includeSnapshot(args.page)
  },
})

export const drag_at = defineInputTool({
  name: 'drag_at',
  description: 'Drag from one coordinate to another',
  input: z.object({
    page: pageParam,
    startX: z.number().describe('Start X coordinate'),
    startY: z.number().describe('Start Y coordinate'),
    endX: z.number().describe('End X coordinate'),
    endY: z.number().describe('End Y coordinate'),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.dragAt(
      args.page,
      { x: args.startX, y: args.startY },
      { x: args.endX, y: args.endY },
    )
    response.text(
      `Dragged from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY})`,
    )
    response.includeSnapshot(args.page)
  },
})

export const hover = defineInputTool({
  name: 'hover',
  description:
    'Hover over a visible page target using the GUI click model. Provide a concise visual prompt for what to hover.',
  input: z.object({
    page: pageParam,
    prompt: z
      .string()
      .min(1)
      .describe('Visual hover instruction, e.g. "hover the account menu"'),
  }),
  output: z.object({
    action: z.literal('hover'),
    page: z.number(),
    prompt: z.string(),
    x: z.number(),
    y: z.number(),
    guiPointDebug: z.record(z.unknown()).optional(),
  }),
  handler: async (args, ctx, response) => {
    const { x, y, log } = await resolveGuiPoint(ctx, args.page, args.prompt)
    const hoverLog = { ...log, hoverPoint: { x, y } }

    const blocked = await enforceAcl('hover', { ...args, x, y }, ctx, response)
    if (blocked) {
      logger.info('GUI hover blocked by ACL', hoverLog)
      return
    }

    await ctx.browser.hoverAt(args.page, x, y)
    response.text('tool call executed successfully')
    response.data({
      action: 'hover',
      page: args.page,
      prompt: args.prompt,
      x,
      y,
      guiPointDebug: hoverLog,
    })
  },
})

export const clear = defineInputTool({
  name: 'clear',
  description: 'Clear the text content of an input or textarea element',
  input: z.object({
    page: pageParam,
    element: elementParam,
  }),
  output: z.object({
    action: z.literal('clear'),
    page: z.number(),
    element: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.fill(args.page, args.element, '', true)
    response.text(`Cleared [${args.element}]`)
    response.data({ action: 'clear', page: args.page, element: args.element })
    response.includeSnapshot(args.page)
  },
})

export const fill = defineInputTool({
  name: 'fill',
  description:
    'Type text into an input or textarea element. Focuses the element, optionally clears existing text, then types character by character.',
  input: z.object({
    page: pageParam,
    element: elementParam,
    text: z.string().describe('Text to type'),
    clear: z
      .boolean()
      .default(true)
      .describe('Clear existing text before typing'),
  }),
  output: z.object({
    action: z.literal('fill'),
    page: z.number(),
    element: z.number(),
    textLength: z.number(),
    clear: z.boolean(),
  }),
  handler: async (args, ctx, response) => {
    const coords = await ctx.browser.fill(
      args.page,
      args.element,
      args.text,
      args.clear,
    )
    const coordText = coords
      ? ` at (${Math.round(coords.x)}, ${Math.round(coords.y)})`
      : ''
    response.text(
      `Typed ${args.text.length} characters into [${args.element}]${coordText}`,
    )
    response.data({
      action: 'fill',
      page: args.page,
      element: args.element,
      textLength: args.text.length,
      clear: args.clear,
    })
    response.includeSnapshot(args.page)
  },
})

export const press_key = defineInputTool({
  name: 'press_key',
  description:
    "Press a key or key combination (e.g. 'Enter', 'Escape', 'Control+A', 'Meta+Shift+P'). Sent to the currently focused element.",
  input: z.object({
    page: pageParam,
    key: z
      .string()
      .describe("Key or combo like 'Enter', 'Control+A', 'ArrowDown'"),
  }),
  output: z.object({
    action: z.literal('press_key'),
    page: z.number(),
    key: z.string(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.pressKey(args.page, args.key)
    response.text(`Pressed ${args.key}`)
    response.data({ action: 'press_key', page: args.page, key: args.key })
  },
})

export const type_text = defineInputTool({
  name: 'type_text',
  description:
    'Type text into the currently focused element. Use after GUI click focuses a text field.',
  input: z.object({
    page: pageParam,
    text: z
      .string()
      .describe('Text to type into the currently focused element'),
  }),
  output: z.object({
    action: z.literal('type_text'),
    page: z.number(),
    textLength: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.typeText(args.page, args.text)
    response.text('tool call executed successfully')
    response.data({
      action: 'type_text',
      page: args.page,
      textLength: args.text.length,
    })
  },
})

export const drag = defineInputTool({
  name: 'drag',
  description:
    'Drag from one element to another element or to specific coordinates',
  input: z.object({
    page: pageParam,
    sourceElement: elementParam.describe('Element ID to drag from'),
    targetElement: z.number().optional().describe('Element ID to drag to'),
    targetX: z
      .number()
      .optional()
      .describe('Target X coordinate (if not using targetElement)'),
    targetY: z
      .number()
      .optional()
      .describe('Target Y coordinate (if not using targetElement)'),
  }),
  output: z.object({
    action: z.literal('drag'),
    page: z.number(),
    sourceElement: z.number(),
    targetElement: z.number().optional(),
    targetX: z.number().optional(),
    targetY: z.number().optional(),
  }),
  handler: async (args, ctx, response) => {
    const coords = await ctx.browser.drag(args.page, args.sourceElement, {
      element: args.targetElement,
      x: args.targetX,
      y: args.targetY,
    })
    const target =
      args.targetElement !== undefined
        ? `[${args.targetElement}]`
        : `(${args.targetX}, ${args.targetY})`
    response.text(
      `Dragged [${args.sourceElement}] (${Math.round(coords.from.x)}, ${Math.round(coords.from.y)}) \u2192 ${target} (${Math.round(coords.to.x)}, ${Math.round(coords.to.y)})`,
    )
    response.data({
      action: 'drag',
      page: args.page,
      sourceElement: args.sourceElement,
      targetElement: args.targetElement,
      targetX: args.targetX,
      targetY: args.targetY,
    })
    response.includeSnapshot(args.page)
  },
})

export const scroll = defineInputTool({
  name: 'scroll',
  description: 'Scroll the page viewport',
  input: z.object({
    page: pageParam,
    direction: z
      .enum(['up', 'down', 'left', 'right'])
      .default('down')
      .describe('Scroll direction'),
    amount: z.number().default(3).describe('Number of scroll ticks'),
  }),
  output: z.object({
    action: z.literal('scroll'),
    page: z.number(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.scroll(args.page, args.direction, args.amount)
    response.text(`Scrolled ${args.direction} by ${args.amount}`)
    response.data({
      action: 'scroll',
      page: args.page,
      direction: args.direction,
      amount: args.amount,
    })
  },
})

export const handle_dialog = defineInputTool({
  name: 'handle_dialog',
  description: 'Accept or dismiss a JavaScript dialog (alert, confirm, prompt)',
  input: z.object({
    page: pageParam,
    accept: z.boolean().describe('true to accept, false to dismiss'),
    promptText: z
      .string()
      .optional()
      .describe('Text to enter for prompt dialogs'),
  }),
  output: z.object({
    action: z.literal('handle_dialog'),
    page: z.number(),
    accept: z.boolean(),
    promptText: z.string().optional(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.handleDialog(args.page, args.accept, args.promptText)
    response.text(args.accept ? 'Dialog accepted' : 'Dialog dismissed')
    response.data({
      action: 'handle_dialog',
      page: args.page,
      accept: args.accept,
      promptText: args.promptText,
    })
  },
})

export const focus = defineInputTool({
  name: 'focus',
  description: 'Focus an element by its ID. Scrolls into view first.',
  input: z.object({
    page: pageParam,
    element: elementParam,
  }),
  output: z.object({
    action: z.literal('focus'),
    page: z.number(),
    element: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.focus(args.page, args.element)
    response.text(`Focused [${args.element}]`)
    response.data({ action: 'focus', page: args.page, element: args.element })
  },
})

export const check = defineInputTool({
  name: 'check',
  description: 'Check a checkbox or radio button. No-op if already checked.',
  input: z.object({
    page: pageParam,
    element: elementParam,
  }),
  output: z.object({
    action: z.literal('check'),
    page: z.number(),
    element: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.check(args.page, args.element)
    response.text(`Checked [${args.element}]`)
    response.data({ action: 'check', page: args.page, element: args.element })
    response.includeSnapshot(args.page)
  },
})

export const uncheck = defineInputTool({
  name: 'uncheck',
  description: 'Uncheck a checkbox. No-op if already unchecked.',
  input: z.object({
    page: pageParam,
    element: elementParam,
  }),
  output: z.object({
    action: z.literal('uncheck'),
    page: z.number(),
    element: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.uncheck(args.page, args.element)
    response.text(`Unchecked [${args.element}]`)
    response.data({ action: 'uncheck', page: args.page, element: args.element })
    response.includeSnapshot(args.page)
  },
})

export const upload_file = defineInputTool({
  name: 'upload_file',
  description:
    'Set file(s) on a file input element. Files must be absolute paths on disk.',
  input: z.object({
    page: pageParam,
    element: elementParam.describe(
      'Element ID of the <input type="file"> element',
    ),
    files: z.array(z.string()).describe('Absolute file paths to upload'),
  }),
  output: z.object({
    action: z.literal('upload_file'),
    page: z.number(),
    element: z.number(),
    files: z.array(z.string()),
    fileCount: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.uploadFile(args.page, args.element, args.files)
    response.text(`Set ${args.files.length} file(s) on [${args.element}]`)
    response.data({
      action: 'upload_file',
      page: args.page,
      element: args.element,
      files: args.files,
      fileCount: args.files.length,
    })
    response.includeSnapshot(args.page)
  },
})

export const select_option = defineInputTool({
  name: 'select_option',
  description:
    'Select an option in a <select> dropdown by value or visible text',
  input: z.object({
    page: pageParam,
    element: elementParam.describe('Element ID of the <select> element'),
    value: z.string().describe('Option value or visible text to select'),
  }),
  output: z.object({
    action: z.literal('select_option'),
    page: z.number(),
    element: z.number(),
    value: z.string(),
    selected: z.string(),
  }),
  handler: async (args, ctx, response) => {
    const selected = await ctx.browser.selectOption(
      args.page,
      args.element,
      args.value,
    )
    if (selected === null) {
      response.error(
        `Option "${args.value}" not found in select [${args.element}]. Use take_snapshot to see available options.`,
      )
      return
    }
    response.text(`Selected "${selected}" in [${args.element}]`)
    response.data({
      action: 'select_option',
      page: args.page,
      element: args.element,
      value: args.value,
      selected,
    })
    response.includeSnapshot(args.page)
  },
})
