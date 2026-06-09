// In-memory + localStorage-backed stub for the custom `chrome.browserOS` API.
// The agent UI talks to the real server, so the only call that must be truthful
// is getPref('browseros.server.mcp_port') — everything else is a benign no-op.

const STORAGE_KEY = 'browseros:web-harness:prefs'
const MCP_PORT_PREF = 'browseros.server.mcp_port'
const DEFAULT_MCP_PORT = 9100

type PrefObject = { key: string; type: string; value: unknown }

// Resolve the real server port from the build env, tolerating unset/empty/NaN.
function resolveMcpPort(): number {
  const parsed = Number(import.meta.env.VITE_BROWSEROS_MCP_PORT)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MCP_PORT
}

function prefType(value: unknown): string {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (value == null) return 'none'
  return 'dict'
}

// Calls the last argument if it is a callback, passing the given default result.
// BrowserOS methods are callback-last across all their overloads.
function respond(args: unknown[], result?: unknown): void {
  const cb = args[args.length - 1]
  if (typeof cb === 'function') (cb as (r: unknown) => void)(result)
}

class PrefStore {
  private values: Record<string, unknown>

  constructor() {
    this.values = this.load()
    // The server port is harness config, not user data — the env var always wins
    // so a changed VITE_BROWSEROS_MCP_PORT takes effect even across reloads where
    // an older port was persisted. Other prefs (e.g. providers) still persist.
    this.values[MCP_PORT_PREF] = resolveMcpPort()
    this.persist()
  }

  get(name: string): PrefObject {
    const value = this.values[name]
    return { key: name, type: prefType(value), value }
  }

  set(name: string, value: unknown): void {
    this.values[name] = value
    this.persist()
  }

  all(): PrefObject[] {
    return Object.keys(this.values).map((key) => this.get(key))
  }

  private load(): Record<string, unknown> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values))
    } catch {
      // ignore quota / unavailable storage
    }
  }
}

export function installBrowserOSStub(target: typeof chrome): void {
  const store = new PrefStore()
  const browserOS = {
    // prefs — backed by a real (localStorage) store so provider config persists
    getPref: (name: string, cb: (p: PrefObject) => void) => cb(store.get(name)),
    setPref: (name: string, value: unknown, ...rest: unknown[]) => {
      store.set(name, value)
      respond(rest, true)
    },
    getAllPrefs: (cb: (p: PrefObject[]) => void) => cb(store.all()),
    // versions — any string works; capabilities enables all features in dev anyway
    getVersionNumber: (cb: (v: string) => void) => cb('140.0.0'),
    getBrowserosVersionNumber: (cb: (v: string) => void) => cb('1.0.0'),
    logMetric: (...a: unknown[]) => respond(a),
    // browser-control methods — unused on the web page (tools run server-side);
    // still invoke their callback so the adapter's typeof guards pass cleanly.
    getPageLoadStatus: (...a: unknown[]) =>
      respond(a, {
        isResourcesLoading: false,
        isDOMContentLoaded: true,
        isPageComplete: true,
      }),
    getAccessibilityTree: (...a: unknown[]) =>
      respond(a, { rootId: 0, nodes: {} }),
    getInteractiveSnapshot: (...a: unknown[]) =>
      respond(a, {
        snapshotId: 0,
        timestamp: 0,
        elements: [],
        processingTimeMs: 0,
      }),
    getSnapshot: (...a: unknown[]) => respond(a, { items: [] }),
    captureScreenshot: (...a: unknown[]) => respond(a, ''),
    click: (...a: unknown[]) => respond(a),
    inputText: (...a: unknown[]) => respond(a),
    clear: (...a: unknown[]) => respond(a),
    scrollUp: (...a: unknown[]) => respond(a),
    scrollDown: (...a: unknown[]) => respond(a),
    scrollToNode: (...a: unknown[]) => respond(a, true),
    sendKeys: (...a: unknown[]) => respond(a),
    executeJavaScript: (...a: unknown[]) => respond(a, null),
    clickCoordinates: (...a: unknown[]) => respond(a),
    typeAtCoordinates: (...a: unknown[]) => respond(a),
    choosePath: (...a: unknown[]) => respond(a, null),
  }
  ;(target as unknown as { browserOS: unknown }).browserOS = browserOS
}
