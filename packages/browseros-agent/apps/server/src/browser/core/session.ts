import type { CdpConnection } from './connection'
import { Input } from './input/input'
import { Navigation } from './navigation'
import { FrameRegistry } from './observer/frames'
import { Observer } from './observer/observer'
import { PageManager } from './pages'

/**
 * Per-browser-session state holder: the page registry today, plus per-page observation,
 * snapshot baselines, and ref maps as later tasks land. One instance is created per MCP
 * session (or directly by the in-process agent) and disposed on session end.
 */
export class BrowserSession {
  readonly pages: PageManager
  private readonly frames: FrameRegistry
  private readonly observers = new Map<number, Observer>()

  constructor(private readonly connection: CdpConnection) {
    this.frames = new FrameRegistry(connection)
    this.pages = new PageManager(connection, (session, pageId, sessionId) =>
      this.frames.registerPage(session, pageId, sessionId),
    )
  }

  /** Per-page observation (snapshot + diff), created lazily and cached. */
  observe(pageId: number): Observer {
    let observer = this.observers.get(pageId)
    if (!observer) {
      observer = new Observer(this.pages, this.frames, pageId)
      this.observers.set(pageId, observer)
    }
    return observer
  }

  /** The action layer (click/fill/type/...) for a page, sharing its observation refs. */
  input(pageId: number): Input {
    return new Input(this.observe(pageId), this.pages, pageId)
  }

  /** Navigation (url/back/forward/reload) for a page. */
  nav(pageId: number): Navigation {
    return new Navigation(this.pages, pageId)
  }

  /** Raw CDP escape hatch for `run` code, e.g. cdp("Page.navigate", { url }). */
  async cdp(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    const api = sessionId ? this.connection.session(sessionId) : this.connection
    const [domain, command] = method.split('.')
    const target = (
      api as unknown as Record<
        string,
        Record<string, (p?: unknown) => Promise<unknown>>
      >
    )[domain]
    if (!target?.[command]) {
      throw new Error(`Unknown CDP method "${method}"`)
    }
    return target[command](params ?? {})
  }

  isConnected(): boolean {
    return this.connection.isConnected()
  }

  async dispose(): Promise<void> {}
}
