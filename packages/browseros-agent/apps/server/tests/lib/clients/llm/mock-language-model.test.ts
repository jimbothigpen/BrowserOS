import { afterEach, describe, expect, it } from 'bun:test'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { shouldUseMockBrowserOSLLM } from '../../../../src/lib/clients/llm/mock-language-model'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_MOCK_FLAG = process.env.BROWSEROS_USE_MOCK_LLM

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
  }

  if (ORIGINAL_MOCK_FLAG === undefined) {
    delete process.env.BROWSEROS_USE_MOCK_LLM
  } else {
    process.env.BROWSEROS_USE_MOCK_LLM = ORIGINAL_MOCK_FLAG
  }
})

describe('shouldUseMockBrowserOSLLM', () => {
  it('enables the mock for BrowserOS in non-production when the flag is set', () => {
    process.env.NODE_ENV = 'test'
    process.env.BROWSEROS_USE_MOCK_LLM = 'true'

    expect(
      shouldUseMockBrowserOSLLM({ provider: LLM_PROVIDERS.BROWSEROS }),
    ).toBe(true)
  })

  it('disables the mock in production even when the flag is set', () => {
    process.env.NODE_ENV = 'production'
    process.env.BROWSEROS_USE_MOCK_LLM = 'true'

    expect(
      shouldUseMockBrowserOSLLM({ provider: LLM_PROVIDERS.BROWSEROS }),
    ).toBe(false)
  })

  it('disables the mock for non-BrowserOS providers', () => {
    process.env.NODE_ENV = 'test'
    process.env.BROWSEROS_USE_MOCK_LLM = 'true'

    expect(shouldUseMockBrowserOSLLM({ provider: LLM_PROVIDERS.OPENAI })).toBe(
      false,
    )
  })
})
