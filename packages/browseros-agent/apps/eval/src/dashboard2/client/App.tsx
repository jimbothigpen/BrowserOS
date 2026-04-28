import { useEffect } from 'react'
import { HistoryPage } from './HistoryPage'
import { LivePage } from './LivePage'
import { useStore } from './store'
import type { StreamEvent, Tab } from './types'

const terminalStatuses = new Set(['completed', 'failed', 'timeout'])

export function App() {
  const tab = useStore((state) => state.tab)
  const setTab = useStore((state) => state.setTab)
  const runState = useStore((state) => state.runState)
  const liveTasks = useStore((state) => state.liveTasks)
  const stopRun = useStore((state) => state.stopRun)
  const resetLive = useStore((state) => state.resetLive)
  const fetchRunList = useStore((state) => state.fetchRunList)
  const restoreState = useStore((state) => state.restoreState)
  const applyEvent = useStore((state) => state.applyEvent)

  useEffect(() => {
    void fetchRunList()
    void restoreState()
  }, [fetchRunList, restoreState])

  useEffect(() => {
    let closed = false
    let source: EventSource | null = null
    let retry: number | null = null

    const connect = () => {
      source = new EventSource('/api/events')
      source.onmessage = (message) => {
        if (!message.data) return
        try {
          applyEvent(JSON.parse(message.data) as StreamEvent)
        } catch {
          // Ignore malformed stream entries.
        }
      }
      source.onerror = () => {
        source?.close()
        if (!closed) retry = window.setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      closed = true
      source?.close()
      if (retry !== null) window.clearTimeout(retry)
    }
  }, [applyEvent])

  const completed = liveTasks.filter((task) =>
    terminalStatuses.has(task.status),
  ).length
  const passCount = liveTasks.filter((task) => {
    const primary = primaryGrader(task.graderResults)
    return primary?.pass
  }).length
  const failCount = liveTasks.filter((task) => {
    const primary = primaryGrader(task.graderResults)
    return primary && !primary.pass
  }).length

  return (
    <main style={styles.shell}>
      <header style={styles.topBar}>
        <div style={styles.title}>Eval Dashboard</div>
        <nav style={styles.tabs}>
          <TabButton
            active={tab === 'live'}
            label="Live"
            onClick={() => setTab('live')}
          />
          <div style={styles.tabDivider} />
          <TabButton
            active={tab === 'history'}
            label="History"
            onClick={() => setTab('history')}
          />
        </nav>
        <div style={styles.runName}>
          {liveTasks.length > 0 ? 'dashboard2' : ''}
        </div>
        <div style={styles.progress}>
          {liveTasks.length > 0
            ? `${completed} / ${liveTasks.length} - ${passCount} pass - ${failCount} fail`
            : ''}
        </div>
        <div style={styles.actions}>
          {runState === 'running' ? (
            <button
              style={styles.dangerButton}
              type="button"
              onClick={() => void stopRun()}
            >
              Stop
            </button>
          ) : null}
          {runState === 'done' ? (
            <button
              style={styles.primaryButton}
              type="button"
              onClick={resetLive}
            >
              New Run
            </button>
          ) : null}
        </div>
      </header>
      <section style={styles.content}>
        {tab === 'live' ? <LivePage /> : <HistoryPage />}
      </section>
    </main>
  )
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: Tab extends infer _ ? string : never
  onClick: () => void
}) {
  return (
    <button
      style={{
        ...styles.tabButton,
        color: active ? '#111827' : '#6b7280',
        background: active ? '#f3f4f6' : 'transparent',
      }}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function primaryGrader(
  graderResults: Record<string, { pass: boolean; score: number }> | undefined,
) {
  if (!graderResults) return null
  return Object.values(graderResults)[0] ?? null
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#f8fafc',
    color: '#111827',
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
  },
  topBar: {
    height: 56,
    flex: '0 0 56px',
    display: 'grid',
    gridTemplateColumns: '180px 150px minmax(120px, 1fr) 260px 120px',
    alignItems: 'center',
    gap: 16,
    padding: '0 20px',
    borderBottom: '1px solid #e5e7eb',
    background: '#ffffff',
  },
  title: {
    fontWeight: 700,
    fontSize: 16,
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  tabButton: {
    border: 0,
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    padding: '7px 10px',
  },
  tabDivider: {
    width: 1,
    height: 18,
    background: '#d1d5db',
  },
  runName: {
    color: '#4b5563',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  progress: {
    color: '#374151',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  primaryButton: {
    border: '1px solid #2563eb',
    borderRadius: 6,
    background: '#2563eb',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 700,
    padding: '8px 12px',
  },
  dangerButton: {
    border: '1px solid #dc2626',
    borderRadius: 6,
    background: '#dc2626',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 700,
    padding: '8px 12px',
  },
  content: {
    minHeight: 0,
    flex: 1,
  },
}
