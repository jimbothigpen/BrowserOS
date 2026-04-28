import { create } from 'zustand'
import * as api from './api'
import type {
  ConfigForm,
  DashboardTask,
  RunState,
  StreamEvent,
  Tab,
} from './types'

const DEFAULT_CONFIG: ConfigForm = {
  provider: 'openai-compatible',
  model: 'accounts/fireworks/models/kimi-k2p5',
  apiKey: 'FIREWORKS_API_KEY',
  baseUrl: 'https://api.fireworks.ai/inference/v1',
}

const STREAM_EVENT_TYPES = new Set([
  'tool-input-available',
  'tool-output-available',
  'tool-output-error',
  'text-delta',
  'text-end',
  'text-start',
  'error',
  'user',
])

function isTerminal(task: DashboardTask): boolean {
  return ['completed', 'failed', 'timeout'].includes(task.status)
}

function parseMessages(raw: string, taskId: string): StreamEvent[] {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as StreamEvent
        return { ...parsed, taskId: parsed.taskId || taskId }
      } catch {
        return null
      }
    })
    .filter((event): event is StreamEvent => event !== null)
}

function updateTaskFromEvent(
  task: DashboardTask,
  event: StreamEvent,
): DashboardTask {
  if (event.type === 'task-state') {
    return {
      ...task,
      status: event.status ?? task.status,
      durationMs:
        typeof event.durationMs === 'number'
          ? event.durationMs
          : task.durationMs,
      graderResults: event.graderResults ?? task.graderResults,
      screenshotCount:
        typeof event.screenshotCount === 'number'
          ? event.screenshotCount
          : task.screenshotCount,
    }
  }

  if (
    typeof event.screenshot === 'number' &&
    event.screenshot > task.screenshotCount
  ) {
    return { ...task, screenshotCount: event.screenshot }
  }

  return task
}

interface Store {
  tab: Tab
  setTab: (tab: Tab) => void

  configForm: ConfigForm
  formError: string | null
  updateConfigForm: (patch: Partial<ConfigForm>) => void

  runState: RunState
  liveTasks: DashboardTask[]
  liveEvents: Record<string, StreamEvent[]>
  startRun: () => Promise<void>
  stopRun: () => Promise<void>
  resetLive: () => void
  restoreState: () => Promise<void>

  pastRuns: string[]
  selectedRun: string | null
  historyTasks: DashboardTask[]
  historyMessages: Record<string, StreamEvent[]>
  historyError: string | null
  fetchRunList: () => Promise<void>
  loadRun: (name: string) => Promise<void>
  loadMessagesIfNeeded: (taskId: string) => Promise<void>

  selectedTaskId: string | null
  autoFollow: boolean
  screenshotIndex: number
  selectTask: (id: string) => void
  setScreenshotIndex: (idx: number) => void

  applyEvent: (event: StreamEvent) => void
}

export const useStore = create<Store>((set, get) => ({
  tab: 'live',
  setTab: (tab) => set({ tab }),

  configForm: DEFAULT_CONFIG,
  formError: null,
  updateConfigForm: (patch) =>
    set((state) => ({
      configForm: { ...state.configForm, ...patch },
      formError: null,
    })),

  runState: 'idle',
  liveTasks: [],
  liveEvents: {},
  startRun: async () => {
    set({ formError: null })
    try {
      await api.startRun(get().configForm)
      const state = await api.fetchState()
      set({
        runState: 'running',
        liveTasks: state.tasks,
        liveEvents: {},
        selectedTaskId: state.tasks[0]?.queryId ?? null,
        screenshotIndex: state.tasks[0]?.screenshotCount ?? 0,
        autoFollow: true,
      })
    } catch (error) {
      set({
        formError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  stopRun: async () => {
    try {
      await api.stopRun()
      set({ runState: 'done' })
    } catch (error) {
      set({
        formError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  resetLive: () =>
    set({
      runState: 'idle',
      liveTasks: [],
      liveEvents: {},
      selectedTaskId: null,
      screenshotIndex: 0,
      autoFollow: true,
      formError: null,
    }),
  restoreState: async () => {
    const state = await api.fetchState()
    if (state.tasks.length === 0) return
    const allTerminal = state.tasks.every(isTerminal)
    set({
      liveTasks: state.tasks,
      runState: state.running ? 'running' : allTerminal ? 'done' : 'idle',
      selectedTaskId: get().selectedTaskId ?? state.tasks[0]?.queryId ?? null,
      screenshotIndex:
        get().screenshotIndex || state.tasks[0]?.screenshotCount || 0,
    })
  },

  pastRuns: [],
  selectedRun: null,
  historyTasks: [],
  historyMessages: {},
  historyError: null,
  fetchRunList: async () => {
    try {
      set({ pastRuns: await api.fetchRuns(), historyError: null })
    } catch (error) {
      set({
        historyError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  loadRun: async (name) => {
    try {
      const result = await api.loadRun(name)
      const firstTask = result.tasks[0]
      set({
        selectedRun: name,
        historyTasks: result.tasks,
        historyMessages: {},
        historyError: null,
        selectedTaskId: firstTask?.queryId ?? null,
        screenshotIndex: firstTask?.screenshotCount ?? 0,
        autoFollow: false,
      })
      if (firstTask) void get().loadMessagesIfNeeded(firstTask.queryId)
    } catch (error) {
      set({
        historyError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  loadMessagesIfNeeded: async (taskId) => {
    const state = get()
    if (state.historyMessages[taskId]) return
    const source = state.tab === 'history' ? 'history' : 'live'
    try {
      const raw = await api.fetchMessages(taskId, source)
      set((current) => ({
        historyMessages: {
          ...current.historyMessages,
          [taskId]: raw ? parseMessages(raw, taskId) : [],
        },
      }))
    } catch {
      set((current) => ({
        historyMessages: { ...current.historyMessages, [taskId]: [] },
      }))
    }
  },

  selectedTaskId: null,
  autoFollow: true,
  screenshotIndex: 0,
  selectTask: (id) => {
    const state = get()
    const tasks = state.tab === 'history' ? state.historyTasks : state.liveTasks
    const task = tasks.find((item) => item.queryId === id)
    const runningTask = state.liveTasks.find(
      (item) => item.status === 'running',
    )
    set({
      selectedTaskId: id,
      screenshotIndex: task?.screenshotCount ?? 0,
      autoFollow: runningTask?.queryId === id,
    })
    if (state.tab === 'history' || (task && isTerminal(task))) {
      void get().loadMessagesIfNeeded(id)
    }
  },
  setScreenshotIndex: (idx) => set({ screenshotIndex: idx }),

  applyEvent: (event) => {
    if (event.type === 'eval-stopped') {
      set({ runState: 'done' })
      return
    }

    const taskId = event.taskId
    if (!taskId || taskId === '_system') return

    set((state) => {
      let nextSelectedTaskId = state.selectedTaskId
      let nextScreenshotIndex = state.screenshotIndex
      let changedTask: DashboardTask | undefined

      const liveTasks = state.liveTasks.map((task) => {
        if (task.queryId !== taskId) return task
        const updated = updateTaskFromEvent(task, event)
        changedTask = updated
        return updated
      })

      if (
        event.type === 'task-state' &&
        event.status === 'running' &&
        state.autoFollow
      ) {
        nextSelectedTaskId = taskId
        nextScreenshotIndex = changedTask?.screenshotCount ?? 0
      }

      if (
        typeof event.screenshot === 'number' &&
        nextSelectedTaskId === taskId
      ) {
        nextScreenshotIndex = event.screenshot
      }

      const allTerminal =
        liveTasks.length > 0 && liveTasks.every((task) => isTerminal(task))
      const liveEvents = STREAM_EVENT_TYPES.has(event.type)
        ? {
            ...state.liveEvents,
            [taskId]: [...(state.liveEvents[taskId] ?? []), event],
          }
        : state.liveEvents

      return {
        liveTasks,
        liveEvents,
        selectedTaskId: nextSelectedTaskId,
        screenshotIndex: nextScreenshotIndex,
        runState: allTerminal ? 'done' : state.runState,
      }
    })
  },
}))

export function getTasksForSource(
  source: 'live' | 'history',
  state: Pick<Store, 'liveTasks' | 'historyTasks'>,
): DashboardTask[] {
  return source === 'live' ? state.liveTasks : state.historyTasks
}
