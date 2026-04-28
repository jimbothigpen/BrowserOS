import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ParallelExecutor } from '../runner/parallel-executor'
import { loadTasks } from '../runner/task-loader'
import { resolveGraderOptions } from '../runner/types'
import { type EvalConfig, EvalConfigSchema, type Task } from '../types'
import index from './client/index.html'
import type { DashboardTask, StreamEvent, TaskStatus } from './client/types'

type DashboardSource = 'live' | 'history'

class DashboardState {
  liveTasks: DashboardTask[] = []
  configName = ''
  agentType = ''
  liveOutputDir = ''
  historyOutputDir = ''
  private sseClients = new Set<(event: StreamEvent) => void>()

  initLive(
    tasks: Task[],
    configName: string,
    agentType: string,
    outputDir: string,
  ) {
    this.configName = configName
    this.agentType = agentType
    this.liveOutputDir = outputDir
    this.liveTasks = tasks.map((task) => ({
      queryId: task.query_id,
      query: task.query,
      startUrl: task.start_url,
      status: 'pending',
      screenshotCount: 0,
    }))
  }

  broadcastStreamEvent(taskId: string, event: Record<string, unknown>) {
    if (event.type === 'task-state') {
      const task = this.liveTasks.find((item) => item.queryId === taskId)
      if (task) {
        task.status = event.status as TaskStatus
        if (typeof event.durationMs === 'number') {
          task.durationMs = event.durationMs
        }
        if (event.graderResults && typeof event.graderResults === 'object') {
          task.graderResults =
            event.graderResults as DashboardTask['graderResults']
        }
        if (typeof event.screenshotCount === 'number') {
          task.screenshotCount = event.screenshotCount
        }
      }
    }

    if (
      typeof event.screenshot === 'number' &&
      (event.type === 'screenshot-captured' ||
        event.type === 'tool-output-available')
    ) {
      const task = this.liveTasks.find((item) => item.queryId === taskId)
      if (task && event.screenshot > task.screenshotCount) {
        task.screenshotCount = event.screenshot
      }
    }

    this.broadcast({ ...event, type: String(event.type), taskId })
  }

  subscribe(fn: (event: StreamEvent) => void) {
    this.sseClients.add(fn)
    return () => this.sseClients.delete(fn)
  }

  broadcast(event: StreamEvent) {
    for (const fn of this.sseClients) {
      try {
        fn(event)
      } catch {
        this.sseClients.delete(fn)
      }
    }
  }
}

const dashboardState = new DashboardState()
const appRoot = resolve(import.meta.dir, '..', '..')
const projectRoot = resolve(import.meta.dir, '..', '..', '..', '..')
const dataDir = join(appRoot, 'data')
const resultsDir = join(appRoot, 'results')
const datasetPath = resolve(dataDir, 'agisdk-real.jsonl')

let evalRunning = false
let activeExecutor: ParallelExecutor | null = null

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function assertInsideRoot(path: string): boolean {
  const resolvedRoot = resolve(projectRoot)
  const resolvedRootPrefix = resolvedRoot.endsWith('/')
    ? resolvedRoot
    : `${resolvedRoot}/`
  return resolve(path).startsWith(resolvedRootPrefix)
}

function parseSource(request: Request): DashboardSource {
  const source = new URL(request.url).searchParams.get('source')
  return source === 'history' ? 'history' : 'live'
}

function outputDirForSource(source: DashboardSource): string {
  if (source === 'history' && dashboardState.historyOutputDir) {
    return dashboardState.historyOutputDir
  }
  return dashboardState.liveOutputDir
}

function sseResponse(): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let keepAlive: Timer | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      unsubscribe = dashboardState.subscribe(send)
      controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode('event: ping\ndata: {}\n\n'))
      }, 10000)
    },
    cancel() {
      unsubscribe?.()
      if (keepAlive) clearInterval(keepAlive)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

async function handleScreenshot(
  request: Bun.BunRequest<'/api/screenshots/:taskId/:idx'>,
): Promise<Response> {
  const { taskId, idx } = request.params
  if (
    taskId.includes('..') ||
    taskId.includes('/') ||
    idx.includes('..') ||
    idx.includes('/')
  ) {
    return json({ error: 'Invalid parameters' }, 400)
  }

  const outputDir = outputDirForSource(parseSource(request))
  if (!outputDir) return json({ error: 'No run loaded' }, 404)

  const filepath = join(outputDir, taskId, 'screenshots', `${idx}.png`)
  const resolved = resolve(filepath)
  const outputRoot = resolve(outputDir)
  const outputRootPrefix = outputRoot.endsWith('/')
    ? outputRoot
    : `${outputRoot}/`
  if (!resolved.startsWith(outputRootPrefix)) {
    return json({ error: 'Invalid path' }, 400)
  }

  const file = Bun.file(filepath)
  if (!(await file.exists())) return new Response(null, { status: 404 })
  return new Response(file, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
    },
  })
}

async function handleMessages(
  request: Bun.BunRequest<'/api/messages/:taskId'>,
): Promise<Response> {
  const { taskId } = request.params
  if (taskId.includes('..') || taskId.includes('/')) {
    return json({ error: 'Invalid parameters' }, 400)
  }

  const outputDir = outputDirForSource(parseSource(request))
  if (!outputDir) return json({ error: 'No run loaded' }, 404)

  const filepath = join(outputDir, taskId, 'messages.jsonl')
  const resolved = resolve(filepath)
  const outputRoot = resolve(outputDir)
  const outputRootPrefix = outputRoot.endsWith('/')
    ? outputRoot
    : `${outputRoot}/`
  if (!resolved.startsWith(outputRootPrefix)) {
    return json({ error: 'Invalid path' }, 400)
  }

  const file = Bun.file(filepath)
  if (!(await file.exists())) return new Response(null, { status: 404 })
  return new Response(file, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}

async function listRuns(): Promise<string[]> {
  const runs: string[] = []
  const entries = await readdir(resultsDir, { withFileTypes: true }).catch(
    () => [],
  )
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const runRoot = join(resultsDir, entry.name)
    const subEntries = await readdir(runRoot, { withFileTypes: true }).catch(
      () => [],
    )
    const timestampDirs = subEntries.filter(
      (item) =>
        item.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(item.name),
    )
    if (timestampDirs.length > 0) {
      for (const sub of timestampDirs) {
        runs.push(`${entry.name}/${sub.name}`)
      }
    } else {
      runs.push(entry.name)
    }
  }
  return runs.sort().reverse()
}

async function loadTasksFromRun(outputDir: string): Promise<{
  agentType: string
  tasks: DashboardTask[]
}> {
  const entries = await readdir(outputDir, { withFileTypes: true })
  const tasks: DashboardTask[] = []
  let agentType = ''

  for (const taskDir of entries.filter((item) => item.isDirectory())) {
    const metaPath = join(outputDir, taskDir.name, 'metadata.json')
    try {
      const raw = JSON.parse(await readFile(metaPath, 'utf-8')) as {
        query_id?: string
        query?: string
        start_url?: string
        termination_reason?: string
        total_duration_ms?: number
        screenshot_count?: number
        total_steps?: number
        agent_config?: { type?: string }
        grader_results?: DashboardTask['graderResults']
      }
      if (!agentType && raw.agent_config?.type) {
        agentType = raw.agent_config.type
      }

      let screenshotCount = raw.screenshot_count ?? raw.total_steps ?? 0
      if (!screenshotCount) {
        const screenshotDir = join(outputDir, taskDir.name, 'screenshots')
        const files = await readdir(screenshotDir).catch(() => [])
        screenshotCount = files.filter((file) => file.endsWith('.png')).length
      }

      tasks.push({
        queryId: raw.query_id || taskDir.name,
        query: raw.query || '',
        startUrl: raw.start_url,
        status:
          raw.termination_reason === 'completed'
            ? 'completed'
            : raw.termination_reason === 'timeout'
              ? 'timeout'
              : 'failed',
        durationMs: raw.total_duration_ms,
        graderResults: raw.grader_results,
        screenshotCount,
      })
    } catch {
      // Ignore incomplete task directories.
    }
  }

  return { agentType, tasks }
}

async function handleLoadRun(request: Request): Promise<Response> {
  let body: { runName?: string }
  try {
    body = (await request.json()) as { runName?: string }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const runName = body.runName
  if (
    !runName ||
    runName.includes('..') ||
    (runName.match(/\//g) || []).length > 1
  ) {
    return json({ error: 'Invalid run name' }, 400)
  }

  const outputDir = resolve(resultsDir, runName)
  if (!outputDir.startsWith(resolve(resultsDir))) {
    return json({ error: 'Invalid path' }, 400)
  }

  const dirStat = await stat(outputDir).catch(() => null)
  if (!dirStat?.isDirectory()) {
    return json({ error: 'Run directory not found' }, 404)
  }

  const loaded = await loadTasksFromRun(outputDir)
  if (loaded.tasks.length === 0) {
    return json({ error: 'No completed tasks found in this run' }, 404)
  }
  dashboardState.historyOutputDir = outputDir

  return json({
    status: 'loaded',
    configName: runName,
    agentType: loaded.agentType,
    taskCount: loaded.tasks.length,
    tasks: loaded.tasks,
  })
}

function buildEvalConfig(agent: EvalConfig['agent']): EvalConfig {
  return {
    agent,
    dataset: datasetPath,
    num_workers: 1,
    restart_server_per_task: true,
    browseros: {
      server_url: 'http://127.0.0.1:9110',
      base_cdp_port: 9010,
      base_server_port: 9110,
      base_extension_port: 9310,
      headless: false,
      load_extensions: false,
    },
    graders: ['agisdk_state_diff'],
    captcha: {
      api_key_env: 'NOPECHA_API_KEY',
      wait_timeout_ms: 30000,
      poll_interval_ms: 1000,
    },
    timeout_ms: 1_800_000,
  }
}

async function handleRun(request: Request): Promise<Response> {
  if (evalRunning) return json({ error: 'Eval already running' }, 409)

  let body: { config?: { agent?: unknown } }
  try {
    body = (await request.json()) as { config?: { agent?: unknown } }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (!assertInsideRoot(datasetPath)) {
    return json(
      { error: 'Invalid dataset path: must be within project root' },
      400,
    )
  }

  const configParseResult = EvalConfigSchema.safeParse(
    buildEvalConfig(body.config?.agent as EvalConfig['agent']),
  )
  if (!configParseResult.success) {
    return json(
      {
        error: 'Config validation failed',
        details: configParseResult.error.errors.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      },
      400,
    )
  }

  const config = configParseResult.data
  const outputDir = join(resultsDir, `dashboard2-${Date.now()}`)
  if (!assertInsideRoot(outputDir)) {
    return json(
      { error: 'Invalid output_dir path: must be within project root' },
      400,
    )
  }

  let tasks: Task[]
  try {
    const result = await loadTasks({ type: 'file', path: config.dataset })
    tasks = result.tasks
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: `Failed to load tasks: ${message}` }, 400)
  }

  await mkdir(outputDir, { recursive: true })
  dashboardState.initLive(tasks, 'dashboard2', config.agent.type, outputDir)

  const executor = new ParallelExecutor({
    numWorkers: 1,
    config,
    outputDir,
    graderOptions: resolveGraderOptions(config),
    restartServerPerTask: config.restart_server_per_task,
    onEvent: (taskId, event) =>
      dashboardState.broadcastStreamEvent(taskId, event),
  })

  activeExecutor = executor
  evalRunning = true
  executor
    .execute(tasks, (completed, total, task, result) => {
      const status =
        result.status === 'completed'
          ? 'DONE'
          : result.status === 'timeout'
            ? 'TIMEOUT'
            : 'FAILED'
      const duration =
        result.durationMs > 0
          ? ` (${(result.durationMs / 1000).toFixed(1)}s)`
          : ''
      console.log(
        `[${completed}/${total}] ${task.query_id}: ${status}${duration}`,
      )
    })
    .finally(() => {
      evalRunning = false
      activeExecutor = null
      console.log('\nEval run complete.')
    })

  return json({ status: 'started', taskCount: tasks.length, outputDir })
}

async function handleStop(): Promise<Response> {
  if (!evalRunning || !activeExecutor) {
    return json({ error: 'No eval running' }, 409)
  }

  await activeExecutor.stop()
  evalRunning = false
  activeExecutor = null
  dashboardState.broadcastStreamEvent('_system', { type: 'eval-stopped' })
  return json({ status: 'stopped' })
}

Bun.serve({
  port: 9901,
  hostname: '127.0.0.1',
  routes: {
    // Serves the Bun HTML import that bundles client/main.tsx and descendants.
    '/': index,
    // Restores live run state after a page reload.
    '/api/state': () =>
      json({
        configName: dashboardState.configName,
        agentType: dashboardState.agentType,
        running: evalRunning,
        tasks: dashboardState.liveTasks,
      }),
    // Starts a hard-coded agisdk-real eval with one worker and a single agent.
    '/api/run': { POST: handleRun },
    // Stops the active executor and broadcasts an eval-stopped event.
    '/api/stop': { POST: handleStop },
    // Streams live executor events to the React store.
    '/api/events': () => sseResponse(),
    // Lists past result directories under apps/eval/results.
    '/api/runs': async () => json(await listRuns()),
    // Loads one past run's task metadata for the History tab.
    '/api/load-run': { POST: handleLoadRun },
    // Serves live or history screenshots, selected by optional source query.
    '/api/screenshots/:taskId/:idx': handleScreenshot,
    // Serves live or history messages.jsonl, selected by optional source query.
    '/api/messages/:taskId': handleMessages,
  },
  development: true,
})

console.log('Dashboard2 listening at http://localhost:9901')
