import { sleep } from './sleep'

const DEFAULT_PROVIDER_ERROR_RETRIES = 5
const DEFAULT_PROVIDER_ERROR_RETRY_WINDOW_MS = 10_000
const PROVIDER_ERROR_LOG_MAX_STRING_CHARS = 10_000
const PROVIDER_ERROR_LOG_MAX_DEPTH = 5

const REDACTED_KEYS = /authorization|api[-_]?key|token|secret|cookie/i

export interface ProviderErrorRetryEvent {
  retryNumber: number
  maxRetries: number
  delayMs: number
  error: unknown
}

export interface ProviderErrorRetryOptions {
  label: string
  signal?: AbortSignal
  retries?: number
  windowMs?: number
  onRetry?: (event: ProviderErrorRetryEvent) => void
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : undefined
}

function readArrayProperty(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as Record<string, unknown>)[key]
  return Array.isArray(raw) ? raw : []
}

function errorMarkers(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return []
  seen.add(error)

  const markers = [
    readStringProperty(error, 'name'),
    error instanceof Error ? error.message : undefined,
  ].filter((value): value is string => !!value)

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if ('isRetryable' in record) markers.push('isRetryable')
    if ('statusCode' in record) markers.push('statusCode')
    if ('responseBody' in record) markers.push('responseBody')
    if ('cause' in record) {
      markers.push(...errorMarkers(record.cause, seen))
    }
  }

  for (const nestedError of readArrayProperty(error, 'errors')) {
    markers.push(...errorMarkers(nestedError, seen))
  }

  return markers
}

export function isProviderExecutionError(error: unknown): boolean {
  const markerText = errorMarkers(error).join('\n')
  return (
    markerText.includes('Provider returned error') ||
    markerText.includes('APICallError') ||
    markerText.includes('AI_RetryError') ||
    markerText.includes('RetryError') ||
    markerText.includes('isRetryable') ||
    markerText.includes('statusCode') ||
    markerText.includes('responseBody')
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncateString(value: string): string {
  if (value.length <= PROVIDER_ERROR_LOG_MAX_STRING_CHARS) return value
  return `${value.slice(0, PROVIDER_ERROR_LOG_MAX_STRING_CHARS)}... (+${value.length - PROVIDER_ERROR_LOG_MAX_STRING_CHARS} chars)`
}

function serializeForLog(
  value: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): unknown {
  if (typeof value === 'string') return truncateString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (depth >= PROVIDER_ERROR_LOG_MAX_DEPTH) return '[MaxDepth]'

  seen.add(value)

  if (value instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }

    for (const key of Object.getOwnPropertyNames(value)) {
      if (key in serialized) continue
      serialized[key] = REDACTED_KEYS.test(key)
        ? '[Redacted]'
        : serializeForLog(
            (value as unknown as Record<string, unknown>)[key],
            depth + 1,
            seen,
          )
    }

    if ('cause' in value) {
      serialized.cause = serializeForLog(value.cause, depth + 1, seen)
    }

    return serialized
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForLog(item, depth + 1, seen))
  }

  const serialized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    serialized[key] = REDACTED_KEYS.test(key)
      ? '[Redacted]'
      : serializeForLog(item, depth + 1, seen)
  }
  return serialized
}

function logFinalProviderError(
  label: string,
  error: unknown,
  attempts: number,
): void {
  console.error(
    `[provider-retry] ${label}: provider error persisted after ${attempts} attempts. Final error:\n${JSON.stringify(
      serializeForLog(error),
      null,
      2,
    )}`,
  )
}

export async function retryProviderErrors<T>(
  operation: () => Promise<T>,
  options: ProviderErrorRetryOptions,
): Promise<T> {
  const maxRetries = options.retries ?? DEFAULT_PROVIDER_ERROR_RETRIES
  const windowMs = options.windowMs ?? DEFAULT_PROVIDER_ERROR_RETRY_WINDOW_MS
  const delayMs = maxRetries > 0 ? Math.floor(windowMs / maxRetries) : 0

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const isProviderError = isProviderExecutionError(error)
      if (options.signal?.aborted || !isProviderError) {
        throw error
      }

      if (attempt >= maxRetries) {
        logFinalProviderError(options.label, error, attempt + 1)
        throw error
      }

      const event = {
        retryNumber: attempt + 1,
        maxRetries,
        delayMs,
        error,
      }
      options.onRetry?.(event)
      console.warn(
        `[provider-retry] ${options.label}: retry ${event.retryNumber}/${maxRetries} in ${delayMs}ms after provider error: ${errorMessage(error)}`,
      )
      await sleep(delayMs, options.signal)
    }
  }
}
