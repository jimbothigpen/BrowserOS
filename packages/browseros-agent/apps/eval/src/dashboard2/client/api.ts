import type {
  ApiErrorResponse,
  ApiStateResponse,
  ConfigForm,
  LoadRunResponse,
  RunResponse,
} from './types'

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T | ApiErrorResponse
  if (!response.ok) {
    const errorData = data as Partial<ApiErrorResponse>
    const message = errorData.error || `HTTP ${response.status}`
    const details = Array.isArray(errorData.details)
      ? `\n${errorData.details.join('\n')}`
      : ''
    throw new Error(`${message}${details}`)
  }
  return data as T
}

export async function fetchState(): Promise<ApiStateResponse> {
  return parseJson<ApiStateResponse>(await fetch('/api/state'))
}

export async function startRun(configForm: ConfigForm): Promise<RunResponse> {
  return parseJson<RunResponse>(
    await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          agent: {
            type: 'single',
            supportsImages: true,
            ...configForm,
          },
        },
      }),
    }),
  )
}

export async function stopRun(): Promise<{ status: string }> {
  return parseJson<{ status: string }>(
    await fetch('/api/stop', { method: 'POST' }),
  )
}

export async function fetchRuns(): Promise<string[]> {
  return parseJson<string[]>(await fetch('/api/runs'))
}

export async function loadRun(name: string): Promise<LoadRunResponse> {
  return parseJson<LoadRunResponse>(
    await fetch('/api/load-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runName: name }),
    }),
  )
}

export async function fetchMessages(
  taskId: string,
  source: 'live' | 'history',
): Promise<string> {
  const response = await fetch(
    `/api/messages/${encodeURIComponent(taskId)}?source=${source}`,
  )
  if (response.status === 404) return ''
  if (!response.ok) {
    throw new Error(`Failed to load messages: HTTP ${response.status}`)
  }
  return response.text()
}
