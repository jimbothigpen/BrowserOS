import { RunResults } from './RunResults'
import { useStore } from './store'

export function HistoryPage() {
  const pastRuns = useStore((state) => state.pastRuns)
  const selectedRun = useStore((state) => state.selectedRun)
  const loadRun = useStore((state) => state.loadRun)
  const historyError = useStore((state) => state.historyError)

  if (selectedRun) {
    return <RunResults source="history" />
  }

  return (
    <div style={styles.wrap}>
      <label style={styles.pickerRow}>
        <span style={styles.label}>Past runs</span>
        <select
          style={styles.select}
          value=""
          onChange={(event) => {
            if (event.target.value) void loadRun(event.target.value)
          }}
        >
          <option value="">
            {pastRuns.length === 0
              ? 'No past runs found. Run an eval first.'
              : 'Select a run'}
          </option>
          {pastRuns.map((run) => (
            <option key={run} value={run}>
              {run}
            </option>
          ))}
        </select>
      </label>
      {historyError ? <div style={styles.error}>{historyError}</div> : null}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: 24,
  },
  pickerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    color: '#374151',
    fontWeight: 700,
  },
  select: {
    minWidth: 360,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#ffffff',
    fontSize: 14,
    padding: '9px 10px',
  },
  error: {
    color: '#b91c1c',
    marginTop: 12,
  },
}
