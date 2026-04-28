import { RunResults } from './RunResults'
import { useStore } from './store'

export function LivePage() {
  const runState = useStore((state) => state.runState)
  const configForm = useStore((state) => state.configForm)
  const updateConfigForm = useStore((state) => state.updateConfigForm)
  const startRun = useStore((state) => state.startRun)
  const formError = useStore((state) => state.formError)

  if (runState !== 'idle') {
    return <RunResults source="live" />
  }

  return (
    <div style={styles.center}>
      <form
        style={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          void startRun()
        }}
      >
        <h1 style={styles.heading}>Configure Eval</h1>
        <label style={styles.row}>
          <span style={styles.label}>Provider</span>
          <select
            style={styles.input}
            value={configForm.provider}
            onChange={(event) =>
              updateConfigForm({
                provider: event.target.value as typeof configForm.provider,
              })
            }
          >
            <option value="openai-compatible">openai-compatible</option>
          </select>
        </label>
        <label style={styles.row}>
          <span style={styles.label}>Model</span>
          <input
            style={styles.input}
            value={configForm.model}
            onChange={(event) =>
              updateConfigForm({ model: event.target.value })
            }
          />
        </label>
        <label style={styles.row}>
          <span style={styles.label}>API Key</span>
          <input
            style={styles.input}
            value={configForm.apiKey}
            onChange={(event) =>
              updateConfigForm({ apiKey: event.target.value })
            }
          />
        </label>
        <label style={styles.row}>
          <span style={styles.label}>Base URL</span>
          <input
            style={styles.input}
            value={configForm.baseUrl}
            onChange={(event) =>
              updateConfigForm({ baseUrl: event.target.value })
            }
          />
        </label>
        {formError ? <div style={styles.error}>{formError}</div> : null}
        <div style={styles.footer}>
          <div style={styles.meta}>
            Dataset: data/agisdk-real.jsonl (52 tasks) - Workers: 1
          </div>
          <button style={styles.button} type="submit">
            Run Eval
          </button>
        </div>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  center: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: 'min(680px, 100%)',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
    padding: 24,
  },
  heading: {
    margin: '0 0 20px',
    fontSize: 20,
    lineHeight: 1.2,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  label: {
    color: '#4b5563',
    fontWeight: 600,
  },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    color: '#111827',
    fontSize: 14,
    padding: '10px 12px',
  },
  error: {
    margin: '8px 0 0 112px',
    color: '#b91c1c',
    whiteSpace: 'pre-wrap',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 20,
  },
  meta: {
    color: '#6b7280',
    fontSize: 13,
  },
  button: {
    border: '1px solid #2563eb',
    borderRadius: 6,
    background: '#2563eb',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 700,
    padding: '10px 14px',
  },
}
