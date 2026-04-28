import { useEffect, useMemo, useRef } from 'react'
import { useStore } from './store'
import type { StreamEvent } from './types'

type RenderEntry =
  | { kind: 'model-text'; text: string; key: string }
  | { kind: 'event'; event: StreamEvent; key: string }

export function AgentStream({ source }: { source: 'live' | 'history' }) {
  const selectedTaskId = useStore((state) => state.selectedTaskId)
  const liveEvents = useStore((state) => state.liveEvents)
  const historyMessages = useStore((state) => state.historyMessages)
  const loadMessagesIfNeeded = useStore((state) => state.loadMessagesIfNeeded)
  const tasks = useStore((state) =>
    source === 'live' ? state.liveTasks : state.historyTasks,
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScroll = useRef(true)

  const task = tasks.find((item) => item.queryId === selectedTaskId)
  const liveForTask = selectedTaskId ? (liveEvents[selectedTaskId] ?? []) : []
  const loadedMessages = selectedTaskId
    ? historyMessages[selectedTaskId]
    : undefined
  const events =
    source === 'live' && liveForTask.length > 0
      ? liveForTask
      : (loadedMessages ?? [])

  useEffect(() => {
    if (!selectedTaskId) return
    if (
      source === 'history' ||
      (task && isTerminal(task.status) && liveForTask.length === 0)
    ) {
      void loadMessagesIfNeeded(selectedTaskId)
    }
  }, [liveForTask.length, loadMessagesIfNeeded, selectedTaskId, source, task])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !shouldAutoScroll.current) return
    node.scrollTop = node.scrollHeight
  })

  const entries = useMemo(() => buildEntries(events), [events])

  return (
    <aside style={styles.stream}>
      <div style={styles.header}>Agent Stream</div>
      <div
        ref={scrollRef}
        style={styles.body}
        onScroll={(event) => {
          const node = event.currentTarget
          shouldAutoScroll.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80
        }}
      >
        {!selectedTaskId ? (
          <div style={styles.empty}>No task selected.</div>
        ) : null}
        {selectedTaskId && events.length === 0 ? (
          <div style={styles.empty}>No event log available.</div>
        ) : null}
        {entries.map((entry) =>
          entry.kind === 'model-text' ? (
            <div key={entry.key} style={styles.modelText}>
              {entry.text}
            </div>
          ) : (
            renderEvent(entry.event, entry.key)
          ),
        )}
      </div>
    </aside>
  )
}

function buildEntries(events: StreamEvent[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  for (const event of events) {
    if (event.type === 'text-delta') {
      const last = entries[entries.length - 1]
      if (last?.kind === 'model-text') {
        last.text += event.delta ?? ''
      } else {
        entries.push({
          kind: 'model-text',
          text: event.delta ?? '',
          key: `${event.taskId}-text-${entries.length}`,
        })
      }
      continue
    }
    if (event.type === 'text-start' || event.type === 'text-end') continue
    entries.push({
      kind: 'event',
      event,
      key: `${event.taskId}-${event.type}-${entries.length}`,
    })
  }
  return entries
}

function renderEvent(event: StreamEvent, key: string) {
  switch (event.type) {
    case 'tool-input-available':
      if (event.toolName === 'delegate') {
        return (
          <StreamCard
            key={key}
            accent="#7c3aed"
            label="Delegation"
            body={delegationText(event.input)}
          />
        )
      }
      return (
        <StreamCard
          key={key}
          accent="#2563eb"
          label={event.toolName ?? 'Tool call'}
          body={formatToolInput(event.input)}
        />
      )
    case 'tool-output-available':
      if (hasParsedActions(event.output)) {
        return <ActionsCard key={key} output={event.output} />
      }
      return (
        <StreamCard
          key={key}
          accent="#16a34a"
          label="Result"
          body={formatToolOutput(event.output)}
        />
      )
    case 'tool-output-error':
      return (
        <StreamCard
          key={key}
          accent="#dc2626"
          label="Error"
          body={formatError(event)}
        />
      )
    case 'error':
      return (
        <StreamCard
          key={key}
          accent="#dc2626"
          label="Error"
          body={String(event.message ?? event.errorText ?? 'Error')}
        />
      )
    case 'user':
      return (
        <StreamCard
          key={key}
          accent="#64748b"
          label="User"
          body={String(event.content ?? '')}
        />
      )
    default:
      return null
  }
}

function StreamCard({
  accent,
  label,
  body,
}: {
  accent: string
  label: string
  body: string
}) {
  return (
    <div style={{ ...styles.card, borderLeftColor: accent }}>
      <div style={styles.cardLabel}>{label}</div>
      <div style={styles.cardBody}>{body}</div>
    </div>
  )
}

function ActionsCard({ output }: { output: ParsedActionsOutput }) {
  return (
    <div style={{ ...styles.card, borderLeftColor: '#0f766e' }}>
      <div style={styles.cardLabel}>Actions</div>
      <div style={styles.actionList}>
        {output.parsedActions.map((action, index) => {
          const result = output.executed?.[index]
          const failed =
            typeof result === 'string' && result.startsWith('Failed')
          return (
            <div
              key={`${action.action ?? 'action'}-${JSON.stringify(action)}-${result ?? ''}`}
              style={styles.actionItem}
            >
              <span
                style={{
                  ...styles.actionStatus,
                  color: failed ? '#b91c1c' : '#166534',
                }}
              >
                {failed ? 'FAIL' : result ? 'OK' : '--'}
              </span>
              <span>{formatAction(action)}</span>
              {failed ? <span style={styles.actionError}>{result}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ParsedAction {
  action?: string
  x?: number
  y?: number
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  direction?: string
  text?: string
  key?: string
  time?: number
}

interface ParsedActionsOutput {
  parsedActions: ParsedAction[]
  executed?: string[]
}

function hasParsedActions(output: unknown): output is ParsedActionsOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    Array.isArray((output as ParsedActionsOutput).parsedActions)
  )
}

function isTerminal(status: string): boolean {
  return ['completed', 'failed', 'timeout'].includes(status)
}

function delegationText(input: unknown): string {
  if (typeof input === 'object' && input !== null && 'instruction' in input) {
    return String((input as { instruction?: unknown }).instruction ?? '')
  }
  return formatToolInput(input)
}

function formatToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === 'page') continue
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    parts.push(`${key}: ${truncate(text ?? '', 100)}`)
  }
  return parts.join(', ')
}

function formatToolOutput(output: unknown): string {
  if (typeof output === 'string') return truncate(output, 220)
  if (typeof output === 'object' && output !== null && 'content' in output) {
    const content = (output as { content?: unknown }).content
    const items = Array.isArray(content) ? content : [content]
    return truncate(
      items
        .map((item) =>
          typeof item === 'string'
            ? item
            : item && typeof item === 'object' && 'text' in item
              ? String((item as { text?: unknown }).text ?? '')
              : JSON.stringify(item),
        )
        .join(' '),
      220,
    )
  }
  return truncate(JSON.stringify(output), 220)
}

function formatError(event: StreamEvent): string {
  const raw = String(event.errorText ?? event.error ?? 'Tool execution failed')
  try {
    const parsed = JSON.parse(raw) as { executed?: string[]; error?: string }
    return parsed.executed?.join('; ') ?? parsed.error ?? raw
  } catch {
    return raw
  }
}

function formatAction(action: ParsedAction): string {
  switch (action.action) {
    case 'click':
      return `click (${action.x}, ${action.y})`
    case 'double_click':
      return `double_click (${action.x}, ${action.y})`
    case 'right_click':
      return `right_click (${action.x}, ${action.y})`
    case 'hover':
      return `hover (${action.x}, ${action.y})`
    case 'type':
      return `type "${truncate(action.text ?? '', 60)}"`
    case 'press_key':
      return `press ${action.key ?? ''}`
    case 'scroll':
      return `scroll ${action.direction ?? 'down'}`
    case 'drag':
      return `drag (${action.startX},${action.startY}) -> (${action.endX},${action.endY})`
    case 'wait':
      return `wait ${action.time ?? 1}s`
    case 'end':
      return 'end'
    case 'navigate':
      return `navigate ${action.text ?? ''}`
    default:
      return action.action ?? 'unknown'
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

const styles: Record<string, React.CSSProperties> = {
  stream: {
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
  },
  header: {
    flex: '0 0 auto',
    padding: '14px 16px',
    borderBottom: '1px solid #e5e7eb',
    color: '#374151',
    fontWeight: 800,
  },
  body: {
    minHeight: 0,
    overflowY: 'auto',
    padding: 12,
  },
  empty: {
    color: '#6b7280',
    padding: 12,
  },
  card: {
    borderLeft: '4px solid #64748b',
    borderTop: '1px solid #e5e7eb',
    borderRight: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#ffffff',
    marginBottom: 10,
    padding: '9px 10px',
  },
  cardLabel: {
    color: '#374151',
    fontSize: 11,
    fontWeight: 800,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  cardBody: {
    color: '#111827',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 12,
    lineHeight: 1.45,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  modelText: {
    border: '1px solid #dbeafe',
    borderRadius: 8,
    background: '#eff6ff',
    color: '#1f2937',
    lineHeight: 1.5,
    marginBottom: 10,
    padding: 10,
    whiteSpace: 'pre-wrap',
  },
  actionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  actionItem: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr)',
    gap: 8,
    color: '#111827',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 12,
  },
  actionStatus: {
    fontWeight: 800,
  },
  actionError: {
    gridColumn: '2 / 3',
    color: '#b91c1c',
    overflowWrap: 'anywhere',
  },
}
