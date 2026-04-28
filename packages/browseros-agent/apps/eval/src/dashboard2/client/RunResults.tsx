import { useEffect } from 'react'
import { AgentStream } from './AgentStream'
import { GraderPanel } from './GraderPanel'
import { ScreenshotViewer } from './ScreenshotViewer'
import { useStore } from './store'
import { TaskList } from './TaskList'

export function RunResults({ source }: { source: 'live' | 'history' }) {
  const tasks = useStore((state) =>
    source === 'live' ? state.liveTasks : state.historyTasks,
  )
  const selectedTaskId = useStore((state) => state.selectedTaskId)
  const selectTask = useStore((state) => state.selectTask)

  useEffect(() => {
    if (
      tasks.length > 0 &&
      !tasks.some((task) => task.queryId === selectedTaskId)
    ) {
      selectTask(tasks[0].queryId)
    }
  }, [tasks, selectedTaskId, selectTask])

  if (tasks.length === 0) {
    return <div style={styles.empty}>No tasks loaded.</div>
  }

  return (
    <div style={styles.layout}>
      <TaskList source={source} />
      <section style={styles.centerColumn}>
        <ScreenshotViewer source={source} />
        <GraderPanel source={source} />
      </section>
      <AgentStream source={source} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    height: '100%',
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: '300px minmax(380px, 1fr) 380px',
    background: '#f8fafc',
  },
  centerColumn: {
    minWidth: 0,
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'minmax(300px, 1fr) minmax(170px, 260px)',
    borderRight: '1px solid #e5e7eb',
  },
  empty: {
    padding: 24,
    color: '#6b7280',
  },
}
