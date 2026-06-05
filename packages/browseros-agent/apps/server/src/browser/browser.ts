import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { logger } from '../lib/logger'
import type { CdpBackend } from './backends/types'
import type { BookmarkNode } from './bookmarks'
import * as bookmarks from './bookmarks'
import {
  ConsoleCollector,
  type GetConsoleLogsOptions,
  type GetConsoleLogsResult,
} from './console-collector'
import {
  buildContentMarkdownExpression,
  type ContentMarkdownOptions,
} from './content-markdown'
import type { PageInfo } from './core/pages'
import { BrowserSession } from './core/session'
import { type DomSearchResult, parseNodeAttributes } from './dom'
import * as elements from './elements'
import type { HistoryEntry } from './history'
import * as history from './history'
import * as keyboard from './keyboard'
import * as mouse from './mouse'
import type { AXNode } from './snapshot'
import * as snapshot from './snapshot'
import type { TabGroup } from './tab-groups'
import * as tabGroups from './tab-groups'

export type { PageInfo } from './core/pages'

export interface WindowInfo {
  windowId: number
  windowType:
    | 'normal'
    | 'popup'
    | 'app'
    | 'devtools'
    | 'app_popup'
    | 'picture_in_picture'
  bounds: {
    left?: number
    top?: number
    width?: number
    height?: number
    windowState?: 'normal' | 'minimized' | 'maximized' | 'fullscreen'
  }
  isActive: boolean
  isVisible: boolean
  tabCount: number
  activeTabId?: number
}

export interface SetWindowVisibilityResult {
  window: WindowInfo
  replaced: boolean
  previousWindowId: number
}

export class Browser {
  private cdp: CdpBackend
  private consoleCollector: ConsoleCollector
  private core: BrowserSession

  constructor(cdp: CdpBackend) {
    this.cdp = cdp
    this.consoleCollector = new ConsoleCollector(cdp)
    this.core = new BrowserSession(cdp, {
      onSessionAttached: async (session, pageId, sessionId) => {
        await session.Log.enable()
        this.consoleCollector.attach(pageId, sessionId)
      },
      onPageDetached: (pageId) => {
        this.consoleCollector.detach(pageId)
      },
    })
  }

  isCdpConnected(): boolean {
    return this.core.isConnected()
  }

  private async resolveSession(page: number): Promise<ProtocolApi> {
    return (await this.core.pages.getSession(page)).session
  }

  async getActivePageForWindow(windowId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getActiveSessionForWindow(windowId)
  }

  /** Resolve a Browser-internal pageId to a CDP session bound to its tab. */
  async getPageSession(pageId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getSession(pageId)
  }

  // --- Pages ---

  async listPages(): Promise<PageInfo[]> {
    return this.core.pages.list()
  }

  getTabIdForPage(pageId: number): number | undefined {
    return this.core.pages.getTabId(pageId)
  }

  getPageInfo(pageId: number): PageInfo | undefined {
    return this.core.pages.getInfo(pageId)
  }

  async refreshPageInfo(pageId: number): Promise<PageInfo | undefined> {
    return this.core.pages.refresh(pageId)
  }

  async getSession(pageId: number): Promise<ProtocolApi | null> {
    return this.core.pages.getAttachedSession(pageId)
  }

  async resolveTabIds(tabIds: number[]): Promise<Map<number, number>> {
    return this.core.pages.resolveTabIds(tabIds)
  }

  async getActivePage(): Promise<PageInfo | null> {
    return this.core.pages.getActive()
  }

  private async resolveWindowIdForNewPage(opts?: {
    hidden?: boolean
    windowId?: number
  }): Promise<number | undefined> {
    if (!opts?.hidden) {
      if (opts?.windowId !== undefined) return opts.windowId

      const windows = await this.listWindows()
      const visibleWindow =
        windows.find((window) => window.isVisible && window.isActive) ??
        windows.find((window) => window.isVisible)
      if (visibleWindow) return visibleWindow.windowId

      return (await this.createWindow({ hidden: false })).windowId
    }

    if (opts.windowId !== undefined) {
      const windows = await this.listWindows()
      const targetWindow = windows.find(
        (window) => window.windowId === opts.windowId,
      )
      if (targetWindow && !targetWindow.isVisible) {
        return targetWindow.windowId
      }
      if (targetWindow?.isVisible) {
        logger.warn(
          'Requested hidden page target window is visible, creating a new hidden window instead',
          {
            requestedWindowId: opts.windowId,
          },
        )
      }
    }

    const hiddenWindow = await this.createWindow({ hidden: true })
    return hiddenWindow.windowId
  }

  async newPage(
    url: string,
    opts?: { hidden?: boolean; background?: boolean; windowId?: number },
  ): Promise<number> {
    const windowId = await this.resolveWindowIdForNewPage(opts)
    return this.core.pages.newPage(url, {
      background: opts?.background,
      windowId,
    })
  }

  async closePage(page: number): Promise<void> {
    await this.core.pages.close(page)
  }

  // --- Navigation ---

  private async waitForLoad(
    session: ProtocolApi,
    timeout = 30000,
  ): Promise<void> {
    const deadline = Date.now() + timeout
    await new Promise((r) => setTimeout(r, 50))

    while (Date.now() < deadline) {
      try {
        const result = await session.Runtime.evaluate({
          expression: 'document.readyState',
          returnByValue: true,
        })
        if ((result.result?.value as string) === 'complete') return
      } catch {
        // Context torn down during navigation — expected
      }
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  async goto(page: number, url: string): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Page.navigate({ url })
    await this.waitForLoad(session)
  }

  async goBack(page: number): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Runtime.evaluate({
      expression: 'history.back()',
      awaitPromise: true,
    })
    await this.waitForLoad(session)
  }

  async goForward(page: number): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Runtime.evaluate({
      expression: 'history.forward()',
      awaitPromise: true,
    })
    await this.waitForLoad(session)
  }

  async reload(page: number): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Page.reload()
    await this.waitForLoad(session)
  }

  async waitFor(
    page: number,
    opts: { text?: string; selector?: string; timeout: number },
  ): Promise<boolean> {
    const session = await this.resolveSession(page)
    const deadline = Date.now() + opts.timeout
    const interval = 500

    while (Date.now() < deadline) {
      if (opts.text) {
        const result = await session.Runtime.evaluate({
          expression: `document.body?.innerText?.includes(${JSON.stringify(opts.text)}) ?? false`,
          returnByValue: true,
        })
        if (result.result?.value === true) return true
      }

      if (opts.selector) {
        const result = await session.Runtime.evaluate({
          expression: `!!document.querySelector(${JSON.stringify(opts.selector)})`,
          returnByValue: true,
        })
        if (result.result?.value === true) return true
      }

      await new Promise((r) => setTimeout(r, interval))
    }

    return false
  }

  // --- Observation ---

  private async getFrameIds(session: ProtocolApi): Promise<string[]> {
    try {
      const result = await session.Page.getFrameTree()
      const ids: string[] = []
      type Tree = { frame: { id: string }; childFrames?: Tree[] }
      function collect(tree: Tree) {
        ids.push(tree.frame.id)
        if (tree.childFrames)
          for (const child of tree.childFrames) collect(child)
      }
      collect(result.frameTree as Tree)
      return ids
    } catch {
      return []
    }
  }

  private async fetchAXTree(session: ProtocolApi): Promise<AXNode[]> {
    const frameIds = await this.getFrameIds(session)

    if (frameIds.length <= 1) {
      const result = await session.Accessibility.getFullAXTree()
      return (result.nodes as AXNode[]) ?? []
    }

    const allNodes: AXNode[] = []
    for (const frameId of frameIds) {
      try {
        const result = await session.Accessibility.getFullAXTree({ frameId })
        const nodes = (result.nodes as AXNode[]) ?? []
        for (const node of nodes) {
          allNodes.push({
            ...node,
            nodeId: `${frameId}:${node.nodeId}`,
            childIds: node.childIds?.map((id) => `${frameId}:${id}`),
          })
        }
      } catch {
        // Cross-origin or detached frames may fail — skip
      }
    }
    return allNodes
  }

  async snapshot(page: number): Promise<string> {
    const session = await this.resolveSession(page)
    const nodes = await this.fetchAXTree(session)
    if (nodes.length === 0) return ''

    const lines = snapshot.buildInteractiveTree(nodes)

    try {
      const cursorElements =
        await snapshot.findCursorInteractiveElements(session)

      if (cursorElements.length > 0) {
        const includedIds = new Set<number>()
        for (const line of lines) {
          const match = line.match(/^\[(\d+)\]/)
          if (match) includedIds.add(Number(match[1]))
        }

        for (const el of cursorElements) {
          if (includedIds.has(el.backendNodeId)) continue
          lines.push(`[${el.backendNodeId}] clickable "${el.text}"`)
        }
      }
    } catch {
      // cursor detection is best-effort; AX tree results are still returned
    }

    return lines.join('\n')
  }

  async getPageLinks(
    page: number,
  ): Promise<Array<{ text: string; href: string }>> {
    const session = await this.resolveSession(page)
    const nodes = await this.fetchAXTree(session)
    const linkNodes = snapshot.extractLinkNodes(nodes)
    if (linkNodes.length === 0) return []

    const results: Array<{ text: string; href: string }> = []
    const seen = new Set<string>()

    for (const link of linkNodes) {
      try {
        const resolved = await session.DOM.resolveNode({
          backendNodeId: link.backendDOMNodeId,
        })
        if (!resolved.object?.objectId) continue

        const hrefResult = await session.Runtime.callFunctionOn({
          objectId: resolved.object.objectId,
          functionDeclaration:
            'function() { return this.href || this.getAttribute("href") || ""; }',
          returnByValue: true,
        })

        const href = hrefResult.result?.value as string
        if (!href || href.startsWith('javascript:') || seen.has(href)) continue
        seen.add(href)
        results.push({ text: link.text, href })
      } catch {
        // skip unresolvable nodes
      }
    }

    return results
  }

  async enhancedSnapshot(page: number): Promise<string> {
    const session = await this.resolveSession(page)
    const nodes = await this.fetchAXTree(session)
    if (nodes.length === 0) return ''

    const treeLines = snapshot.buildEnhancedTree(nodes)

    try {
      const cursorElements =
        await snapshot.findCursorInteractiveElements(session)

      if (cursorElements.length > 0) {
        const includedIds = new Set<number>()
        for (const line of treeLines) {
          const match = line.match(/\[(\d+)\]/)
          if (match) includedIds.add(Number(match[1]))
        }

        const extras: string[] = []
        for (const el of cursorElements) {
          if (includedIds.has(el.backendNodeId)) continue
          extras.push(
            `[${el.backendNodeId}] clickable "${el.text}" (${el.reasons.join(', ')})`,
          )
        }

        if (extras.length > 0) {
          treeLines.push('# Cursor-interactive (no ARIA role):')
          treeLines.push(...extras)
        }
      }
    } catch (err) {
      logger.debug('Cursor-interactive detection failed', {
        error: String(err),
      })
    }

    return treeLines.join('\n')
  }

  async content(page: number, selector?: string): Promise<string> {
    const session = await this.resolveSession(page)
    const expression = selector
      ? `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '')`
      : `(document.body?.innerText ?? '')`

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })

    return (result.result?.value as string) ?? ''
  }

  async contentAsMarkdown(
    page: number,
    opts?: Omit<ContentMarkdownOptions, 'selector'> & { selector?: string },
  ): Promise<string> {
    const session = await this.resolveSession(page)
    const expression = buildContentMarkdownExpression({
      selector: opts?.selector,
      viewportOnly: opts?.viewportOnly,
      includeLinks: opts?.includeLinks,
      includeImages: opts?.includeImages,
    })

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })

    return (result.result?.value as string) ?? ''
  }

  async screenshot(
    page: number,
    opts: { format: string; quality?: number; fullPage: boolean },
  ): Promise<{ data: string; mimeType: string; devicePixelRatio: number }> {
    const session = await this.resolveSession(page)

    const params: Record<string, unknown> = {
      format: opts.format,
      captureBeyondViewport: opts.fullPage,
    }
    if (opts.quality !== undefined) params.quality = opts.quality

    const [screenshotResult, dprResult] = await Promise.allSettled([
      session.Page.captureScreenshot(
        params as Parameters<ProtocolApi['Page']['captureScreenshot']>[0],
      ),
      session.Runtime.evaluate({
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      }),
    ])

    if (screenshotResult.status === 'rejected') throw screenshotResult.reason

    const result = screenshotResult.value
    const devicePixelRatio =
      dprResult.status === 'fulfilled' &&
      typeof dprResult.value.result?.value === 'number'
        ? dprResult.value.result.value
        : 1

    return {
      data: result.data,
      mimeType: `image/${opts.format}`,
      devicePixelRatio,
    }
  }

  async evaluate(
    page: number,
    expression: string,
  ): Promise<{
    value?: unknown
    error?: string
    description?: string
  }> {
    const session = await this.resolveSession(page)

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    })

    if (result.exceptionDetails) {
      return {
        error:
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      }
    }

    return {
      value: result.result?.value,
      description: result.result?.description,
    }
  }

  async getDom(page: number, opts?: { selector?: string }): Promise<string> {
    const session = await this.resolveSession(page)
    const doc = await session.DOM.getDocument({ depth: 0 })

    let nodeId = doc.root.nodeId
    if (opts?.selector) {
      const found = await session.DOM.querySelector({
        nodeId: doc.root.nodeId,
        selector: opts.selector,
      })
      if (!found.nodeId) return ''
      nodeId = found.nodeId
    }

    const result = await session.DOM.getOuterHTML({ nodeId })
    return result.outerHTML
  }

  async searchDom(
    page: number,
    query: string,
    opts?: { limit?: number },
  ): Promise<{ results: DomSearchResult[]; totalCount: number }> {
    const session = await this.resolveSession(page)
    const limit = opts?.limit ?? 25

    await session.DOM.getDocument({ depth: 0 })
    const search = await session.DOM.performSearch({ query })
    const count = Math.min(search.resultCount, limit)

    if (count === 0) {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
      return { results: [], totalCount: search.resultCount }
    }

    try {
      const matched = await session.DOM.getSearchResults({
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: count,
      })

      const results: DomSearchResult[] = []
      const seen = new Set<number>()
      for (const nodeId of matched.nodeIds) {
        try {
          const desc = await session.DOM.describeNode({ nodeId, depth: 0 })
          let node = desc.node
          let resolvedNodeId = nodeId

          // Text/comment nodes: resolve to parent element via JS
          if (node.nodeType !== 1) {
            const resolved = await session.DOM.resolveNode({ nodeId })
            if (!resolved.object.objectId) continue
            const parentResult = await session.Runtime.callFunctionOn({
              objectId: resolved.object.objectId,
              functionDeclaration: 'function() { return this.parentElement; }',
              returnByValue: false,
            })
            if (!parentResult.result.objectId) continue
            const parentNode = await session.DOM.requestNode({
              objectId: parentResult.result.objectId,
            })
            resolvedNodeId = parentNode.nodeId
            const parentDesc = await session.DOM.describeNode({
              nodeId: parentNode.nodeId,
              depth: 0,
            })
            node = parentDesc.node
          }

          if (node.nodeType !== 1) continue
          if (seen.has(node.backendNodeId)) continue
          seen.add(node.backendNodeId)

          results.push({
            tag: node.localName,
            nodeId: resolvedNodeId,
            backendNodeId: node.backendNodeId,
            attributes: parseNodeAttributes(node),
          })
        } catch {
          // node may have been removed between search and describe
        }
      }

      return { results, totalCount: search.resultCount }
    } finally {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
    }
  }

  // --- Input ---

  async click(
    page: number,
    element: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<{ x: number; y: number } | undefined> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)

    try {
      const { x, y } = await elements.getElementCenter(session, element)
      await mouse.dispatchClick(
        session,
        x,
        y,
        opts?.button ?? 'left',
        opts?.clickCount ?? 1,
        0,
      )
      return { x, y }
    } catch {
      logger.debug(
        `CDP click failed for element=${element}, falling back to JS click`,
      )
      await elements.jsClick(session, element)
      return undefined
    }
  }

  async clickAt(
    page: number,
    x: number,
    y: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchClick(
      session,
      x,
      y,
      opts?.button ?? 'left',
      opts?.clickCount ?? 1,
      0,
    )
  }

  async hoverAt(page: number, x: number, y: number): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchHover(session, x, y)
  }

  async typeAt(
    page: number,
    x: number,
    y: number,
    text: string,
    clear = false,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchClick(session, x, y, 'left', 1, 0)
    if (clear) await keyboard.clearField(session)
    await keyboard.typeText(session, text)
  }

  async dragAt(
    page: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchDrag(session, from, to)
  }

  async hover(
    page: number,
    element: number,
  ): Promise<{ x: number; y: number }> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)
    const { x, y } = await elements.getElementCenter(session, element)
    await mouse.dispatchHover(session, x, y)
    return { x, y }
  }

  async fill(
    page: number,
    element: number,
    text: string,
    clear = true,
  ): Promise<{ x: number; y: number } | undefined> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)

    // Always click to guarantee real keyboard focus.
    // DOM.focus() is unreliable for shadow DOM, iframes, and custom components.
    let coords: { x: number; y: number } | undefined
    try {
      const { x, y } = await elements.getElementCenter(session, element)
      await mouse.dispatchClick(session, x, y, 'left', 1, 0)
      coords = { x, y }
    } catch {
      // Fallback to DOM.focus() if we can't get coordinates
      try {
        await elements.focusElement(session, element)
      } catch {
        logger.warn('Could not focus element via click or DOM.focus()')
      }
    }

    if (clear) {
      // Primary: keyboard select-all + backspace
      await keyboard.clearField(session)

      // Fallback: if field still has content, triple-click to select all
      // then typeText will overwrite the selection
      if (coords) {
        const value = await elements.getInputValue(session, element)
        if (value) {
          await mouse.dispatchClick(session, coords.x, coords.y, 'left', 3, 0)
        }
      }
    }

    await keyboard.typeText(session, text)
    return coords
  }

  async pressKey(page: number, key: string): Promise<void> {
    const session = await this.resolveSession(page)
    await keyboard.pressCombo(session, key)
  }

  async drag(
    page: number,
    sourceElement: number,
    target: { element?: number; x?: number; y?: number },
  ): Promise<{
    from: { x: number; y: number }
    to: { x: number; y: number }
  }> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, sourceElement)
    const from = await elements.getElementCenter(session, sourceElement)

    let to: { x: number; y: number }
    if (target.element !== undefined) {
      to = await elements.getElementCenter(session, target.element)
    } else if (target.x !== undefined && target.y !== undefined) {
      to = { x: target.x, y: target.y }
    } else {
      throw new Error(
        'Provide either target element or both targetX and targetY.',
      )
    }

    await mouse.dispatchDrag(session, from, to)
    return { from, to }
  }

  async scroll(
    page: number,
    direction: string,
    amount: number,
    element?: number,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    const pixels = amount * 120
    const deltaX =
      direction === 'left' ? -pixels : direction === 'right' ? pixels : 0
    const deltaY =
      direction === 'up' ? -pixels : direction === 'down' ? pixels : 0

    if (deltaX === 0 && deltaY === 0) return

    let x: number
    let y: number
    if (element !== undefined) {
      const center = await elements.getElementCenter(session, element)
      x = center.x
      y = center.y
    } else {
      const metrics = await session.Page.getLayoutMetrics()
      x = metrics.layoutViewport.clientWidth / 2
      y = metrics.layoutViewport.clientHeight / 2
    }

    const beforeWindowPosition =
      element === undefined
        ? await this.getWindowScrollPosition(session)
        : undefined

    await mouse.dispatchScroll(session, x, y, deltaX, deltaY)

    if (beforeWindowPosition === undefined) return

    const afterWindowPosition = await this.getWindowScrollPosition(session)
    const moved = this.didScrollInExpectedDirection(
      beforeWindowPosition,
      afterWindowPosition,
      deltaX,
      deltaY,
    )
    if (moved) return

    await this.fallbackWindowScroll(session, deltaX, deltaY)
  }

  private async getWindowScrollPosition(
    session: ProtocolApi,
  ): Promise<{ x: number; y: number }> {
    const result = await session.Runtime.evaluate({
      expression:
        '({ x: window.scrollX ?? window.pageXOffset ?? 0, y: window.scrollY ?? window.pageYOffset ?? 0 })',
      returnByValue: true,
    })
    const value = (result.result?.value ?? {}) as { x?: number; y?: number }
    return {
      x: typeof value.x === 'number' ? value.x : 0,
      y: typeof value.y === 'number' ? value.y : 0,
    }
  }

  private didScrollInExpectedDirection(
    before: { x: number; y: number },
    after: { x: number; y: number },
    deltaX: number,
    deltaY: number,
  ): boolean {
    if (deltaX > 0 && after.x > before.x) return true
    if (deltaX < 0 && after.x < before.x) return true
    if (deltaY > 0 && after.y > before.y) return true
    if (deltaY < 0 && after.y < before.y) return true
    return false
  }

  private async fallbackWindowScroll(
    session: ProtocolApi,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await session.Runtime.evaluate({
      expression: `window.scrollBy(${deltaX}, ${deltaY})`,
      returnByValue: true,
    })
  }

  async handleDialog(
    page: number,
    accept: boolean,
    promptText?: string,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Page.handleJavaScriptDialog({
      accept,
      ...(promptText !== undefined && { promptText }),
    })
  }

  async selectOption(
    page: number,
    element: number,
    value: string,
  ): Promise<string | null> {
    const session = await this.resolveSession(page)

    const selected = await elements.callOnElement(
      session,
      element,
      `function(val){
				for(var i=0;i<this.options.length;i++){
					if(this.options[i].value===val||this.options[i].textContent.trim()===val){
						this.selectedIndex=i;
						this.dispatchEvent(new Event('change',{bubbles:true}));
						return this.options[i].textContent.trim();
					}
				}
				return null;
			}`,
      [value],
    )

    return selected as string | null
  }

  // --- Form helpers ---

  async focus(page: number, element: number): Promise<void> {
    const session = await this.resolveSession(page)
    await elements.scrollIntoView(session, element)
    await elements.focusElement(session, element)
  }

  async check(page: number, element: number): Promise<boolean> {
    const session = await this.resolveSession(page)
    const checked = await elements.callOnElement(
      session,
      element,
      'function(){return this.checked}',
    )
    if (!checked) await this.click(page, element)
    return true
  }

  async uncheck(page: number, element: number): Promise<boolean> {
    const session = await this.resolveSession(page)
    const checked = await elements.callOnElement(
      session,
      element,
      'function(){return this.checked}',
    )
    if (checked) await this.click(page, element)
    return false
  }

  async uploadFile(
    page: number,
    element: number,
    files: string[],
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await session.DOM.setFileInputFiles({ files, backendNodeId: element })
  }

  // --- File operations ---

  async printToPDF(
    page: number,
    opts?: { landscape?: boolean; printBackground?: boolean },
  ): Promise<{ data: string }> {
    const session = await this.resolveSession(page)
    const result = await session.Page.printToPDF({
      landscape: opts?.landscape ?? false,
      printBackground: opts?.printBackground ?? true,
    })
    return { data: result.data }
  }

  async downloadViaClick(
    page: number,
    element: number,
    downloadPath: string,
  ): Promise<{ filePath: string; suggestedFilename: string }> {
    await this.cdp.Browser.setDownloadBehavior({
      behavior: 'allowAndName',
      downloadPath,
      eventsEnabled: true,
    })

    return new Promise<{ filePath: string; suggestedFilename: string }>(
      (resolve, reject) => {
        let guid = ''
        let suggestedFilename = ''
        const timeout = setTimeout(() => {
          cleanUp()
          reject(new Error('Download timed out after 60s'))
        }, 60000)

        const unsubBegin = this.cdp.Browser.on(
          'downloadWillBegin',
          (params) => {
            guid = params.guid
            suggestedFilename = params.suggestedFilename
          },
        )

        const unsubProgress = this.cdp.Browser.on(
          'downloadProgress',
          (params) => {
            if (params.guid === guid && params.state === 'completed') {
              cleanUp()
              resolve({
                filePath: `${downloadPath}/${guid}`,
                suggestedFilename,
              })
            }
            if (params.guid === guid && params.state === 'canceled') {
              cleanUp()
              reject(new Error('Download was canceled'))
            }
          },
        )

        const cleanUp = () => {
          clearTimeout(timeout)
          unsubBegin()
          unsubProgress()
          this.cdp.Browser.setDownloadBehavior({ behavior: 'default' }).catch(
            () => {},
          )
        }

        this.click(page, element).catch((err) => {
          cleanUp()
          reject(err)
        })
      },
    )
  }

  // --- Windows ---

  async listWindows(): Promise<WindowInfo[]> {
    const result = await this.cdp.Browser.getWindows()
    return result.windows as WindowInfo[]
  }

  async createWindow(opts?: { hidden?: boolean }): Promise<WindowInfo> {
    const result = await this.cdp.Browser.createWindow({
      hidden: opts?.hidden ?? false,
    })
    return result.window as WindowInfo
  }

  async closeWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.closeWindow({ windowId })
  }

  async activateWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.activateWindow({ windowId })
  }

  /**
   * Changes a window between hidden and visible states.
   * BrowserOS may replace the underlying window, so callers must use the returned window ID.
   */
  async setWindowVisibility(
    windowId: number,
    opts: { visible: boolean; activate?: boolean },
  ): Promise<SetWindowVisibilityResult> {
    const result = await this.cdp.Browser.setWindowVisibility({
      windowId,
      visible: opts.visible,
      ...(opts.activate !== undefined && { activate: opts.activate }),
    })
    return {
      window: result.window as WindowInfo,
      replaced: result.replaced,
      previousWindowId: result.previousWindowId,
    }
  }

  async showPage(
    page: number,
    opts?: { windowId?: number; index?: number; activate?: boolean },
  ): Promise<PageInfo> {
    return this.core.pages.show(page, opts)
  }

  async movePage(
    page: number,
    opts?: { windowId?: number; index?: number },
  ): Promise<PageInfo> {
    return this.core.pages.move(page, opts)
  }

  // --- Bookmarks ---

  async getBookmarks(): Promise<BookmarkNode[]> {
    return bookmarks.getBookmarks(this.cdp)
  }

  async createBookmark(params: {
    title: string
    url?: string
    parentId?: string
  }): Promise<BookmarkNode> {
    return bookmarks.createBookmark(this.cdp, params)
  }

  async removeBookmark(id: string): Promise<void> {
    return bookmarks.removeBookmark(this.cdp, id)
  }

  async updateBookmark(
    id: string,
    changes: { url?: string; title?: string },
  ): Promise<BookmarkNode> {
    return bookmarks.updateBookmark(this.cdp, id, changes)
  }

  async moveBookmark(
    id: string,
    destination: { parentId?: string; index?: number },
  ): Promise<BookmarkNode> {
    return bookmarks.moveBookmark(this.cdp, id, destination)
  }

  async searchBookmarks(query: string): Promise<BookmarkNode[]> {
    return bookmarks.searchBookmarks(this.cdp, query)
  }

  // --- History ---

  async searchHistory(
    query: string,
    maxResults?: number,
  ): Promise<HistoryEntry[]> {
    return history.searchHistory(this.cdp, query, maxResults)
  }

  async getRecentHistory(maxResults?: number): Promise<HistoryEntry[]> {
    return history.getRecentHistory(this.cdp, maxResults)
  }

  async deleteHistoryUrl(url: string): Promise<void> {
    return history.deleteUrl(this.cdp, url)
  }

  async deleteHistoryRange(startTime: number, endTime: number): Promise<void> {
    return history.deleteRange(this.cdp, startTime, endTime)
  }

  // --- Tab Groups ---

  private resolvePageIdsToTabIds(pageIds: number[]): number[] {
    return pageIds.map((pageId) => {
      const info = this.getPageInfo(pageId)
      if (!info)
        throw new Error(
          `Unknown page ${pageId}. Use list_pages to see available pages.`,
        )
      return info.tabId
    })
  }

  async listTabGroups(): Promise<
    (Omit<TabGroup, 'tabIds'> & { pageIds: number[] })[]
  > {
    const pages = await this.listPages()
    const groups = await tabGroups.listTabGroups(this.cdp)

    const tabToPage = new Map<number, number>()
    for (const info of pages) {
      tabToPage.set(info.tabId, info.pageId)
    }

    return groups.map((group) => {
      const { tabIds, ...rest } = group
      return {
        ...rest,
        pageIds: tabIds
          .map((tabId) => tabToPage.get(tabId))
          .filter((id): id is number => id !== undefined),
      }
    })
  }

  async groupTabs(
    pageIds: number[],
    opts?: { title?: string; groupId?: string },
  ): Promise<Omit<TabGroup, 'tabIds'> & { pageIds: number[] }> {
    const pages = await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    const group = await tabGroups.groupTabs(this.cdp, tabIds, opts)

    const tabToPage = new Map<number, number>()
    for (const info of pages) {
      tabToPage.set(info.tabId, info.pageId)
    }

    const { tabIds: groupTabIds, ...rest } = group
    return {
      ...rest,
      pageIds: groupTabIds
        .map((tabId) => tabToPage.get(tabId))
        .filter((id): id is number => id !== undefined),
    }
  }

  async updateTabGroup(
    groupId: string,
    opts: { title?: string; color?: string; collapsed?: boolean },
  ): Promise<TabGroup> {
    return tabGroups.updateTabGroup(this.cdp, groupId, opts)
  }

  async ungroupTabs(pageIds: number[]): Promise<void> {
    await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    return tabGroups.ungroupTabs(this.cdp, tabIds)
  }

  async closeTabGroup(groupId: string): Promise<void> {
    return tabGroups.closeTabGroup(this.cdp, groupId)
  }

  // --- Console ---

  async getConsoleLogs(
    page: number,
    opts?: GetConsoleLogsOptions,
  ): Promise<GetConsoleLogsResult> {
    await this.resolveSession(page)
    return this.consoleCollector.getLogs(page, opts)
  }
}
