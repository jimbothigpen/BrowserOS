import { z } from 'zod'
import { logger } from '../lib/logger'
import { getMolmoPointClient } from '../lib/molmopoint-client'
import { defineTool } from './framework'

const pageParam = z.number().describe('Page ID (from list_pages)')
const elementParam = z
  .number()
  .describe('Element ID from snapshot (the number in [N])')

const CLICK_MARKER_PRE_CLICK_DELAY_MS = 250

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildClickMarkerExpression(x: number, y: number): string {
  return `((cx, cy) => {
  const AIM_ID = '__molmo_click_aim';
  const setStyles = (el, styles) => {
    for (const [key, value] of Object.entries(styles)) {
      el.style.setProperty(key, value, 'important');
    }
  };
  document.querySelectorAll('[data-molmo-click-aim="true"]').forEach((el) => el.remove());

  const host = document.createElement('div');
  host.id = AIM_ID;
  host.dataset.molmoClickAim = 'true';
  setStyles(host, {
    position: 'fixed',
    left: cx + 'px',
    top: cy + 'px',
    width: '0',
    height: '0',
    'pointer-events': 'none',
    'z-index': '2147483647',
    contain: 'layout paint style',
    transform: 'translateZ(0)'
  });

  const halo = document.createElement('div');
  setStyles(halo, {
    position: 'absolute',
    left: '-32px',
    top: '-32px',
    width: '64px',
    height: '64px',
    'border-radius': '9999px',
    border: '2px solid rgba(239, 68, 68, 0.45)',
    'box-shadow': '0 0 32px 10px rgba(239, 68, 68, 0.28)',
    background: 'rgba(239, 68, 68, 0.06)'
  });

  const ring = document.createElement('div');
  setStyles(ring, {
    position: 'absolute',
    left: '-22px',
    top: '-22px',
    width: '44px',
    height: '44px',
    'border-radius': '9999px',
    border: '4px solid #ef4444',
    'box-shadow': '0 0 0 3px rgba(255, 255, 255, 0.95), 0 8px 24px rgba(0, 0, 0, 0.35)'
  });

  const horizontal = document.createElement('div');
  setStyles(horizontal, {
    position: 'absolute',
    left: '-34px',
    top: '-2px',
    width: '68px',
    height: '4px',
    'border-radius': '9999px',
    background: '#ef4444',
    'box-shadow': '0 0 0 2px rgba(255, 255, 255, 0.95)'
  });

  const vertical = document.createElement('div');
  setStyles(vertical, {
    position: 'absolute',
    left: '-2px',
    top: '-34px',
    width: '4px',
    height: '68px',
    'border-radius': '9999px',
    background: '#ef4444',
    'box-shadow': '0 0 0 2px rgba(255, 255, 255, 0.95)'
  });

  const dot = document.createElement('div');
  setStyles(dot, {
    position: 'absolute',
    left: '-6px',
    top: '-6px',
    width: '12px',
    height: '12px',
    'border-radius': '9999px',
    background: '#ef4444',
    border: '3px solid #fff',
    'box-shadow': '0 2px 10px rgba(0, 0, 0, 0.45)'
  });

  host.append(halo, horizontal, vertical, ring, dot);
  (document.documentElement || document.body).appendChild(host);

  const animate = (el, frames, options) => {
    try {
      if (typeof el.animate === 'function') el.animate(frames, options);
    } catch {
      // Static marker remains visible if Web Animations are unavailable.
    }
  };
  animate(host, [
    { transform: 'translateZ(0) scale(0.72)', opacity: 0 },
    { transform: 'translateZ(0) scale(1)', opacity: 1, offset: 0.18 },
    { transform: 'translateZ(0) scale(1)', opacity: 1, offset: 0.78 },
    { transform: 'translateZ(0) scale(1.18)', opacity: 0 }
  ], { duration: 1400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' });
  animate(halo, [
    { transform: 'scale(0.7)', opacity: 0.95 },
    { transform: 'scale(1.25)', opacity: 0 }
  ], { duration: 1100, easing: 'ease-out', fill: 'forwards' });

  setTimeout(() => host.remove(), 1600);
  return null;
})(${JSON.stringify(x)}, ${JSON.stringify(y)})`
}

export const click = defineTool({
  name: 'click',
  description:
    'Click an element by natural-language description (e.g. "the blue ' +
    'Submit button", "the close X on the modal"). Uses the MolmoPoint ' +
    'vision model on a fresh screenshot — no snapshot needed.',
  input: z.object({
    page: pageParam,
    target: z
      .string()
      .describe('Natural-language description of what to click'),
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
    target: z.string(),
    button: z.enum(['left', 'right', 'middle']),
    clickCount: z.number(),
    x: z.number(),
    y: z.number(),
    modelText: z.string(),
  }),
  handler: async (args, ctx, response) => {
    logger.info('click(target) called', {
      page: args.page,
      target: args.target,
    })

    const client = getMolmoPointClient()
    if (!client) {
      logger.error('click: BROWSEROS_MOLMOPOINT_URL not set')
      response.error(
        'click requires BROWSEROS_MOLMOPOINT_URL to be set to the ' +
          'MolmoPoint server URL.',
      )
      return
    }

    const t0 = performance.now()
    const shot = await ctx.browser.screenshot(args.page, {
      format: 'png',
      fullPage: false,
    })
    const dpr = shot.devicePixelRatio || 1
    logger.info('click: screenshot captured', {
      ms: Math.round(performance.now() - t0),
      dpr,
      bytes: shot.data.length,
    })

    const t1 = performance.now()
    let prediction: Awaited<ReturnType<typeof client.predict>>
    try {
      prediction = await client.predict(shot.data, args.target)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('click: MolmoPoint predict failed', {
        target: args.target,
        err: msg,
      })
      response.error(`MolmoPoint request failed: ${msg}`)
      return
    }
    logger.info('click: MolmoPoint responded', {
      ms: Math.round(performance.now() - t1),
      pointCount: prediction.points.length,
      firstPoint: prediction.points[0],
      modelText: prediction.text,
      imageSize: prediction.image_size,
    })

    const point = prediction.points[0]
    if (!point) {
      logger.warn('click: MolmoPoint returned no points', {
        target: args.target,
        modelText: prediction.text,
      })
      response.error(
        `MolmoPoint returned no point for "${args.target}". Model said: ${prediction.text || '<empty>'}`,
      )
      return
    }

    // MolmoPoint returns image-pixel coords; CDP wants CSS-pixel coords.
    const x = point.x / dpr
    const y = point.y / dpr
    logger.info('click: dispatching', {
      target: args.target,
      x: Math.round(x),
      y: Math.round(y),
      dpr,
    })

    // Show an aim marker before dispatching the click. The short delay gives
    // Chromium a paint frame, which matters when the click immediately navigates.
    const markerResult = await ctx.browser
      .evaluate(args.page, buildClickMarkerExpression(x, y))
      .catch(() => undefined)
    if (!markerResult?.error) {
      await delay(CLICK_MARKER_PRE_CLICK_DELAY_MS)
    }

    await ctx.browser.clickAt(args.page, x, y, {
      button: args.button,
      clickCount: args.clickCount,
    })

    response.text(
      `Clicked "${args.target}" at (${Math.round(x)}, ${Math.round(y)}) [molmopoint: "${prediction.text}"]`,
    )
    response.data({
      action: 'click',
      page: args.page,
      target: args.target,
      button: args.button,
      clickCount: args.clickCount,
      x,
      y,
      modelText: prediction.text,
    })
    response.includeSnapshot(args.page)
  },
})

export const type = defineTool({
  name: 'type',
  description:
    'Type text into the currently focused element. Call ' +
    '`click({target: ...})` first to focus the right input.',
  input: z.object({
    page: pageParam,
    text: z.string().describe('Text to type'),
  }),
  output: z.object({
    action: z.literal('type'),
    page: z.number(),
    textLength: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.type(args.page, args.text)
    response.text(`Typed ${args.text.length} characters`)
    response.data({
      action: 'type',
      page: args.page,
      textLength: args.text.length,
    })
    response.includeSnapshot(args.page)
  },
})

export const drag_at = defineTool({
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

export const hover = defineTool({
  name: 'hover',
  description: 'Hover over an element by its ID',
  input: z.object({
    page: pageParam,
    element: elementParam,
  }),
  output: z.object({
    action: z.literal('hover'),
    page: z.number(),
    element: z.number(),
  }),
  handler: async (args, ctx, response) => {
    const coords = await ctx.browser.hover(args.page, args.element)
    response.text(
      `Hovered over [${args.element}] at (${Math.round(coords.x)}, ${Math.round(coords.y)})`,
    )
    response.data({ action: 'hover', page: args.page, element: args.element })
  },
})

export const clear = defineTool({
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

export const fill = defineTool({
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

export const press_key = defineTool({
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

export const drag = defineTool({
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

export const scroll = defineTool({
  name: 'scroll',
  description: 'Scroll the page or a specific element',
  input: z.object({
    page: pageParam,
    direction: z
      .enum(['up', 'down', 'left', 'right'])
      .default('down')
      .describe('Scroll direction'),
    amount: z.number().default(3).describe('Number of scroll ticks'),
    element: z
      .number()
      .optional()
      .describe('Element ID to scroll at (scrolls page center if omitted)'),
  }),
  output: z.object({
    action: z.literal('scroll'),
    page: z.number(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number(),
    element: z.number().optional(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.scroll(
      args.page,
      args.direction,
      args.amount,
      args.element,
    )
    response.text(`Scrolled ${args.direction} by ${args.amount}`)
    response.data({
      action: 'scroll',
      page: args.page,
      direction: args.direction,
      amount: args.amount,
      element: args.element,
    })
  },
})

export const handle_dialog = defineTool({
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

export const focus = defineTool({
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

export const check = defineTool({
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

export const uncheck = defineTool({
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

export const upload_file = defineTool({
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

export const select_option = defineTool({
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
