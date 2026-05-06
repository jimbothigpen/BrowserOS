import { describe, expect, it } from 'bun:test'
import {
  isProviderExecutionError,
  retryProviderErrors,
} from '../../src/utils/provider-error-retry'

function providerError(message = 'Provider returned error'): Error {
  const error = new Error(message)
  error.name = 'APICallError'
  ;(error as unknown as Record<string, unknown>).statusCode = 500
  ;(error as unknown as Record<string, unknown>).responseBody =
    '{"error":"upstream failed"}'
  return error
}

async function withoutRetryWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn
  const originalError = console.error
  console.warn = () => {}
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.warn = originalWarn
    console.error = originalError
  }
}

describe('provider error retries', () => {
  it('detects provider errors from SDK-style markers', () => {
    expect(isProviderExecutionError(providerError())).toBe(true)
    expect(isProviderExecutionError(new Error('regular tool failure'))).toBe(
      false,
    )
  })

  it('retries provider errors and returns a later success', async () => {
    await withoutRetryWarnings(async () => {
      let calls = 0
      const result = await retryProviderErrors(
        async () => {
          calls++
          if (calls <= 3) throw providerError()
          return 'ok'
        },
        { label: 'test', retries: 5, windowMs: 0 },
      )

      expect(result).toBe('ok')
      expect(calls).toBe(4)
    })
  })

  it('throws the final provider error after retries are exhausted', async () => {
    const originalWarn = console.warn
    const originalError = console.error
    const errorLogs: string[] = []
    console.warn = () => {}
    console.error = (message?: unknown) => {
      errorLogs.push(String(message))
    }

    try {
      let calls = 0
      await expect(
        retryProviderErrors(
          async () => {
            calls++
            throw providerError()
          },
          { label: 'test', retries: 5, windowMs: 0 },
        ),
      ).rejects.toThrow('Provider returned error')
      expect(calls).toBe(6)
      expect(errorLogs.join('\n')).toContain(
        'provider error persisted after 6 attempts',
      )
      expect(errorLogs.join('\n')).toContain('responseBody')
      expect(errorLogs.join('\n')).toContain('upstream failed')
    } finally {
      console.warn = originalWarn
      console.error = originalError
    }
  })

  it('does not retry non-provider errors', async () => {
    let calls = 0
    await expect(
      retryProviderErrors(
        async () => {
          calls++
          throw new Error('tool failed')
        },
        { label: 'test', retries: 5, windowMs: 0 },
      ),
    ).rejects.toThrow('tool failed')
    expect(calls).toBe(1)
  })
})
