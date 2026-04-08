import type { Message } from '../types'
import { isToolInputAvailable, isToolOutputAvailable } from '../types/message'

export interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    cookies: unknown[]
    headers: Array<{ name: string; value: string }>
    queryString: Array<{ name: string; value: string }>
    headersSize: number
    bodySize: number
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    cookies: unknown[]
    headers: Array<{ name: string; value: string }>
    content: { size: number; mimeType: string; text: string }
    redirectURL: string
    headersSize: number
    bodySize: number
  }
  cache: Record<string, never>
  timings: { send: number; wait: number; receive: number }
}

export interface HarLog {
  version: string
  creator: { name: string; version: string }
  entries: HarEntry[]
}

export interface Har {
  log: HarLog
}

const NAVIGATION_TOOLS = new Set([
  'browser_navigate',
  'browser_navigate_url',
  'navigate',
])

function parseQueryString(url: string): Array<{ name: string; value: string }> {
  try {
    const parsed = new URL(url)
    return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({
      name,
      value,
    }))
  } catch {
    return []
  }
}

/**
 * Build a minimal HAR 1.2 from eval messages.
 * Extracts navigation tool calls and their outputs to reconstruct
 * the HTTP request/response pairs the evaluator needs.
 */
export function buildHarFromMessages(messages: Message[]): Har {
  const entries: HarEntry[] = []

  const toolOutputs = new Map<string, { output: unknown; timestamp: string }>()
  for (const msg of messages) {
    if (isToolOutputAvailable(msg)) {
      toolOutputs.set(msg.toolCallId, {
        output: msg.output,
        timestamp:
          'timestamp' in msg
            ? (msg.timestamp as string)
            : new Date().toISOString(),
      })
    }
  }

  for (const msg of messages) {
    if (!isToolInputAvailable(msg)) continue
    if (!NAVIGATION_TOOLS.has(msg.toolName)) continue

    const input = msg.input as Record<string, unknown>
    const url = (input.url as string) || (input.href as string) || ''
    if (!url) continue

    const timestamp =
      'timestamp' in msg ? (msg.timestamp as string) : new Date().toISOString()

    const result = toolOutputs.get(msg.toolCallId)
    const outputStr = result?.output != null ? String(result.output) : ''

    // Infer status: if output contains error indicators, mark as failed
    const hasError =
      outputStr.includes('ERR_') ||
      outputStr.includes('net::') ||
      outputStr.includes('Navigation failed')
    const status = hasError ? 500 : 200
    const statusText = hasError ? 'Error' : 'OK'

    entries.push({
      startedDateTime: timestamp,
      time: 0,
      request: {
        method: 'GET',
        url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [{ name: 'User-Agent', value: 'BrowserOS-Eval/1.0' }],
        queryString: parseQueryString(url),
        headersSize: -1,
        bodySize: 0,
      },
      response: {
        status,
        statusText,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        content: {
          size: outputStr.length,
          mimeType: 'text/html',
          text: outputStr.substring(0, 10000),
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: outputStr.length,
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    })
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'browseros-eval', version: '1.0.0' },
      entries,
    },
  }
}
