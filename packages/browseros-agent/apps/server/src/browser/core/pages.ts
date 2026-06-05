import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import {
  type CdpConnection,
  EXCLUDED_URL_PREFIXES,
  type SessionId,
} from './connection'

export interface PageInfo {
  pageId: number
  targetId: string
  tabId: number
  url: string
  title: string
  isActive: boolean
  isLoading: boolean
  loadProgress: number
  isPinned: boolean
  isHidden: boolean
  windowId?: number
  index?: number
  groupId?: string
}

// Shape returned by the custom Browser.* CDP domain (a PageInfo without our synthetic pageId).
type TabInfo = Omit<PageInfo, 'pageId'>

export interface PageSession {
  targetId: string
  session: ProtocolApi
  url: string
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Owns the mapping from a stable, monotonic pageId to a live CDP tab + attached session.
 * Reconciles against BrowserOS's custom `Browser.getTabs` domain and caches one session per
 * target. `onSessionAttached` lets the frame subsystem enable auto-attach without this class
 * knowing about frames.
 */
export class PageManager {
  private readonly pages = new Map<number, PageInfo>()
  private readonly sessions = new Map<string, SessionId>()
  private nextPageId = 1

  constructor(
    private readonly cdp: CdpConnection,
    private readonly onSessionAttached?: (
      session: ProtocolApi,
      pageId: number,
      sessionId: string,
    ) => Promise<void>,
  ) {}

  /** Reconcile the registry with the browser's live tabs (upsert + drop vanished). */
  async list(): Promise<PageInfo[]> {
    const result = await this.cdp.Browser.getTabs({ includeHidden: true })
    const tabs = (result.tabs as TabInfo[]).filter(
      (tab) =>
        !EXCLUDED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix)),
    )

    const seen = new Set<string>()
    for (const tab of tabs) {
      seen.add(tab.targetId)
      const existing = this.findByTarget(tab.targetId)
      if (existing) {
        // CDP omits windowId for hidden tabs — preserve the cached value.
        Object.assign(existing, tab, {
          windowId: tab.windowId ?? existing.windowId,
        })
      } else {
        const pageId = this.nextPageId++
        this.pages.set(pageId, { pageId, ...tab })
      }
    }

    for (const [pageId, info] of this.pages) {
      if (!seen.has(info.targetId)) this.pages.delete(pageId)
    }

    return [...this.pages.values()].sort((a, b) => a.pageId - b.pageId)
  }

  getInfo(pageId: number): PageInfo | undefined {
    return this.pages.get(pageId)
  }

  /** Resolve a pageId to its attached CDP session, listing pages first if unseen. */
  async getSession(pageId: number): Promise<PageSession> {
    let info = this.pages.get(pageId)
    if (!info) {
      await this.list()
      info = this.pages.get(pageId)
    }
    if (!info) {
      throw new Error(`Unknown page ${pageId}. List pages to see what is open.`)
    }
    const sessionId = await this.attach(info.targetId, pageId)
    return {
      targetId: info.targetId,
      session: this.cdp.session(sessionId),
      url: info.url,
    }
  }

  async newPage(
    url: string,
    opts?: { background?: boolean; windowId?: number },
  ): Promise<number> {
    const created = await this.cdp.Browser.createTab({
      url,
      ...(opts?.background !== undefined && { background: opts.background }),
      ...(opts?.windowId !== undefined && { windowId: opts.windowId }),
    })
    const tabId = (created.tab as TabInfo).tabId

    let tab: TabInfo | undefined
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        tab = (await this.cdp.Browser.getTabInfo({ tabId })).tab as TabInfo
        break
      } catch {
        await delay(100)
      }
    }
    if (!tab) throw new Error(`Tab ${tabId} not found after creation`)

    const pageId = this.nextPageId++
    this.pages.set(pageId, { pageId, ...tab, url: tab.url || url })
    return pageId
  }

  async close(pageId: number): Promise<void> {
    const info = this.pages.get(pageId)
    if (!info) throw new Error(`Unknown page ${pageId}.`)
    await this.cdp.Browser.closeTab({ tabId: info.tabId })
    this.pages.delete(pageId)
    this.sessions.delete(info.targetId)
  }

  private async attach(targetId: string, pageId: number): Promise<SessionId> {
    const cached = this.sessions.get(targetId)
    if (cached) return cached

    const { sessionId } = await this.cdp.Target.attachToTarget({
      targetId,
      flatten: true,
    })
    const session = this.cdp.session(sessionId)
    await Promise.all([
      session.Page.enable(),
      session.DOM.enable(),
      session.Runtime.enable(),
      session.Accessibility.enable(),
    ])
    this.sessions.set(targetId, sessionId)
    await this.onSessionAttached?.(session, pageId, sessionId)
    return sessionId
  }

  private findByTarget(targetId: string): PageInfo | undefined {
    for (const info of this.pages.values()) {
      if (info.targetId === targetId) return info
    }
    return undefined
  }
}
