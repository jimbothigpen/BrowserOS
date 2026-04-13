function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function parseSSELines<T>(buffer: string): {
  events: T[]
  remainder: string
} {
  const lines = buffer.split('\n')
  const remainder = lines.pop() ?? ''
  const events: T[] = []

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload === '[DONE]') continue
    try {
      events.push(JSON.parse(payload) as T)
    } catch {}
  }

  return { events, remainder }
}

export async function consumeSSEStream<T>(
  response: Response,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  const abortReader = () => {
    void reader.cancel()
  }

  signal?.addEventListener('abort', abortReader, { once: true })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const { events, remainder } = parseSSELines<T>(buffer)
      buffer = remainder

      for (const event of events) {
        onEvent(event)
      }
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return
    throw error
  } finally {
    signal?.removeEventListener('abort', abortReader)
    const trailing = decoder.decode()
    if (trailing) {
      buffer += trailing
    }
    if (buffer) {
      const { events } = parseSSELines<T>(buffer)
      for (const event of events) {
        onEvent(event)
      }
    }
  }
}
