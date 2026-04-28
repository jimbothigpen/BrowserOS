import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'

export function ScreenshotViewer({ source }: { source: 'live' | 'history' }) {
  const tasks = useStore((state) =>
    source === 'live' ? state.liveTasks : state.historyTasks,
  )
  const selectedTaskId = useStore((state) => state.selectedTaskId)
  const screenshotIndex = useStore((state) => state.screenshotIndex)
  const setScreenshotIndex = useStore((state) => state.setScreenshotIndex)
  const [autoplay, setAutoplay] = useState(false)
  const [imageError, setImageError] = useState(false)

  const task = tasks.find((item) => item.queryId === selectedTaskId)
  const max = task?.screenshotCount ?? 0
  const current =
    max === 0 ? 0 : Math.min(Math.max(screenshotIndex || max, 1), max)

  useEffect(() => {
    setImageError(false)
    if (max > 0 && screenshotIndex !== current) {
      setScreenshotIndex(current)
    }
  }, [current, max, screenshotIndex, setScreenshotIndex])

  useEffect(() => {
    if (!autoplay || max === 0) return
    const timer = window.setInterval(() => {
      const latest = useStore.getState().screenshotIndex
      if (latest >= max) {
        setAutoplay(false)
        return
      }
      setScreenshotIndex(latest + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoplay, max, setScreenshotIndex])

  const src = useMemo(() => {
    if (!selectedTaskId || current === 0) return ''
    const id = encodeURIComponent(selectedTaskId)
    return `/api/screenshots/${id}/${current}?source=${source}&t=${Date.now()}`
  }, [current, selectedTaskId, source])

  return (
    <section style={styles.viewer}>
      <div style={styles.header}>
        <div style={styles.query}>{task?.query ?? 'No task selected'}</div>
        <div style={styles.controls}>
          <button
            style={styles.controlButton}
            type="button"
            disabled={current <= 1}
            onClick={() => setScreenshotIndex(current - 1)}
          >
            &lt;
          </button>
          <span style={styles.counter}>
            {current ? `${current} / ${max}` : '-'}
          </span>
          <button
            style={styles.controlButton}
            type="button"
            disabled={current >= max}
            onClick={() => setScreenshotIndex(current + 1)}
          >
            &gt;
          </button>
          <button
            style={styles.playButton}
            type="button"
            disabled={max === 0}
            onClick={() => setAutoplay((value) => !value)}
          >
            {autoplay ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>
      <div style={styles.imageWrap}>
        {src && !imageError ? (
          <img
            alt={`Screenshot ${current}`}
            src={src}
            style={styles.image}
            onError={() => setImageError(true)}
          />
        ) : (
          <div style={styles.placeholder}>No screenshot</div>
        )}
      </div>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  viewer: {
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: '58px 1fr',
    background: '#f8fafc',
  },
  header: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderBottom: '1px solid #e5e7eb',
    background: '#ffffff',
  },
  query: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#374151',
    fontWeight: 700,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  controlButton: {
    width: 32,
    height: 32,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#ffffff',
    cursor: 'pointer',
  },
  counter: {
    width: 58,
    color: '#4b5563',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  },
  playButton: {
    height: 32,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#ffffff',
    cursor: 'pointer',
    padding: '0 10px',
  },
  imageWrap: {
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'auto',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    border: '1px solid #d1d5db',
    background: '#ffffff',
  },
  placeholder: {
    color: '#6b7280',
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    padding: '28px 36px',
    background: '#ffffff',
  },
}
