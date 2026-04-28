import { PASS_FAIL_GRADER_ORDER } from '../../runner/types'
import { useStore } from './store'
import type { DashboardTask } from './types'

export function GraderPanel({ source }: { source: 'live' | 'history' }) {
  const tasks = useStore((state) =>
    source === 'live' ? state.liveTasks : state.historyTasks,
  )
  const selectedTaskId = useStore((state) => state.selectedTaskId)
  const task = tasks.find((item) => item.queryId === selectedTaskId)
  const primary = getPrimaryGrader(task)

  if (!task || !primary) {
    return (
      <section style={styles.panel}>
        <div style={styles.empty}>No grader result.</div>
      </section>
    )
  }

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.name}>{formatGraderName(primary.name)}</span>
        <span
          style={{
            ...styles.score,
            color: primary.result.pass ? '#166534' : '#991b1b',
            background: primary.result.pass ? '#dcfce7' : '#fee2e2',
          }}
        >
          {primary.result.pass ? 'PASS' : 'FAIL'} -{' '}
          {(primary.result.score * 100).toFixed(1)}%
        </span>
      </div>
      <div style={styles.body}>{renderBody(primary.name, primary.result)}</div>
    </section>
  )
}

type GraderResult = NonNullable<DashboardTask['graderResults']>[string]

function getPrimaryGrader(task?: DashboardTask) {
  if (!task?.graderResults) return null
  for (const name of PASS_FAIL_GRADER_ORDER) {
    const result = task.graderResults[name]
    if (result) return { name, result }
  }
  const first = Object.entries(task.graderResults)[0]
  return first ? { name: first[0], result: first[1] } : null
}

function renderBody(name: string, result: GraderResult) {
  if (name === 'performance_grader') {
    return <PerformanceGrader result={result} />
  }
  if (name === 'fara_combined' || name === 'fara_grader') {
    return <FaraGrader result={result} />
  }
  return <GenericGrader result={result} />
}

function PerformanceGrader({ result }: { result: GraderResult }) {
  const axes = readRecord(result.details?.axes)
  if (!axes) return <GenericGrader result={result} />

  return (
    <div style={styles.axes}>
      {Object.entries(axes).map(([name, axisValue]) => {
        const axis = readRecord(axisValue) ?? {}
        const score = readNumber(axis.score, 0)
        return (
          <div
            key={name}
            style={{
              ...styles.axis,
              borderLeftColor: scoreColor(score),
            }}
          >
            <div style={styles.axisHead}>
              <span style={styles.axisName}>{name.replace(/_/g, ' ')}</span>
              <span style={{ ...styles.axisScore, color: scoreColor(score) }}>
                {score}/100
              </span>
              <span style={styles.weight}>w:{readNumber(axis.weight, 0)}</span>
            </div>
            <div style={styles.bar}>
              <div
                style={{
                  ...styles.barFill,
                  width: `${Math.max(0, Math.min(100, score))}%`,
                  background: scoreColor(score),
                }}
              />
            </div>
            <div style={styles.reasoning}>{String(axis.reasoning ?? '')}</div>
          </div>
        )
      })}
    </div>
  )
}

function FaraGrader({ result }: { result: GraderResult }) {
  const verifiers = readRecord(result.details?.verifiers)
  if (!verifiers) return <GenericGrader result={result} />
  const voting = readRecord(result.details?.votingResult)

  return (
    <div>
      {voting ? (
        <div style={styles.voting}>
          Majority vote: {String(voting.passCount ?? 0)}/
          {String(voting.totalVerifiers ?? 0)} passed -{' '}
          <strong
            style={{
              color: voting.decision === 'PASS' ? '#166534' : '#991b1b',
            }}
          >
            {String(voting.decision ?? '')}
          </strong>
        </div>
      ) : null}
      <div style={styles.verifiers}>
        {Object.entries(verifiers).map(([name, value]) => {
          const verifier = readRecord(value) ?? {}
          const pass = Boolean(verifier.pass)
          const score =
            typeof verifier.score === 'number'
              ? `${(verifier.score * 100).toFixed(0)}%`
              : ''
          return (
            <div key={name} style={styles.verifier}>
              <span style={styles.verifierName}>{formatGraderName(name)}</span>
              <span
                style={{
                  ...styles.verifierBadge,
                  color: pass ? '#166534' : '#991b1b',
                  background: pass ? '#dcfce7' : '#fee2e2',
                }}
              >
                {pass ? 'PASS' : 'FAIL'}
              </span>
              <span style={styles.verifierScore}>{score}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GenericGrader({ result }: { result: GraderResult }) {
  return <div style={styles.generic}>{result.reasoning || 'No reasoning.'}</div>
}

function formatGraderName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a'
  if (score >= 40) return '#d97706'
  return '#dc2626'
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    minHeight: 0,
    borderTop: '1px solid #e5e7eb',
    background: '#ffffff',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 14px',
    borderBottom: '1px solid #e5e7eb',
  },
  name: {
    color: '#111827',
    fontWeight: 800,
  },
  score: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    padding: '4px 8px',
    whiteSpace: 'nowrap',
  },
  body: {
    height: 'calc(100% - 50px)',
    overflowY: 'auto',
    padding: 12,
  },
  empty: {
    color: '#6b7280',
    padding: 16,
  },
  axes: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  axis: {
    borderLeft: '4px solid #94a3b8',
    borderTop: '1px solid #e5e7eb',
    borderRight: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
  },
  axisHead: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  axisName: {
    color: '#111827',
    fontWeight: 800,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  axisScore: {
    fontWeight: 800,
  },
  weight: {
    color: '#6b7280',
    fontSize: 11,
  },
  bar: {
    height: 7,
    borderRadius: 999,
    background: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
  },
  reasoning: {
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
  },
  voting: {
    color: '#4b5563',
    fontSize: 12,
    marginBottom: 10,
  },
  verifiers: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  verifier: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '8px 10px',
  },
  verifierName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 700,
  },
  verifierBadge: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    padding: '3px 7px',
  },
  verifierScore: {
    color: '#6b7280',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  generic: {
    color: '#374151',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
}
