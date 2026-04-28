import { PASS_FAIL_GRADER_ORDER } from '../../runner/types'
import { useStore } from './store'
import type { DashboardTask } from './types'

export function TaskList({ source }: { source: 'live' | 'history' }) {
  const tasks = useStore((state) =>
    source === 'live' ? state.liveTasks : state.historyTasks,
  )
  const selectedTaskId = useStore((state) => state.selectedTaskId)
  const selectTask = useStore((state) => state.selectTask)

  const renderTask = (task: DashboardTask) => {
    const primary = getPrimaryGrader(task)
    const selected = task.queryId === selectedTaskId
    return (
      <button
        key={task.queryId}
        style={{
          ...styles.row,
          background: selected ? '#eff6ff' : '#ffffff',
          borderColor: selected ? '#93c5fd' : '#e5e7eb',
        }}
        type="button"
        onClick={() => selectTask(task.queryId)}
      >
        <span
          style={{
            ...styles.statusDot,
            background: statusColor(task.status),
          }}
        />
        <span style={styles.rowBody}>
          <span style={styles.rowHead}>
            <span style={styles.queryId}>{task.queryId}</span>
            <span style={styles.duration}>
              {formatDuration(task.durationMs)}
            </span>
          </span>
          <span style={styles.query}>{task.query}</span>
          <span style={styles.badgeLine}>
            {primary ? (
              <span
                style={{
                  ...styles.badge,
                  color: primary.pass ? '#166534' : '#991b1b',
                  background: primary.pass ? '#dcfce7' : '#fee2e2',
                }}
              >
                {primary.name}: {primary.pass ? 'PASS' : 'FAIL'}
              </span>
            ) : (
              <span style={styles.mutedBadge}>{task.status}</span>
            )}
          </span>
        </span>
      </button>
    )
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>Tasks</div>
      <div style={styles.list}>{tasks.map(renderTask)}</div>
    </aside>
  )
}

function getPrimaryGrader(task: DashboardTask) {
  if (!task.graderResults) return null
  for (const name of PASS_FAIL_GRADER_ORDER) {
    const result = task.graderResults[name]
    if (result) return { name, ...result }
  }
  const first = Object.entries(task.graderResults)[0]
  return first ? { name: first[0], ...first[1] } : null
}

function statusColor(status: DashboardTask['status']): string {
  switch (status) {
    case 'completed':
      return '#16a34a'
    case 'failed':
      return '#dc2626'
    case 'timeout':
      return '#d97706'
    case 'running':
      return '#2563eb'
    default:
      return '#9ca3af'
  }
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return ''
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #e5e7eb',
    background: '#ffffff',
  },
  header: {
    flex: '0 0 auto',
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    color: '#374151',
    fontWeight: 800,
  },
  list: {
    minHeight: 0,
    overflowY: 'auto',
    padding: 10,
  },
  row: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 1fr)',
    gap: 10,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    cursor: 'pointer',
    marginBottom: 8,
    padding: 10,
    textAlign: 'left',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    marginTop: 4,
  },
  rowBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  rowHead: {
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
  },
  queryId: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#111827',
    fontWeight: 800,
    fontSize: 12,
  },
  duration: {
    color: '#6b7280',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  query: {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 1.35,
  },
  badgeLine: {
    minHeight: 20,
  },
  badge: {
    display: 'inline-block',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    padding: '3px 7px',
  },
  mutedBadge: {
    display: 'inline-block',
    borderRadius: 999,
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 7px',
  },
}
