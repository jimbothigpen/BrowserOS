/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from '../../logger'

const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

export function createCodexFetch(accountId?: string) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    let inputUrl: string
    if (typeof input === 'string') {
      inputUrl = input
    } else if (input instanceof URL) {
      inputUrl = input.toString()
    } else if (input instanceof Request) {
      inputUrl = input.url
    } else {
      inputUrl = String(input)
    }

    const parsed = new URL(inputUrl)
    const shouldRewrite =
      parsed.pathname.includes('/v1/responses') ||
      parsed.pathname.includes('/chat/completions')
    const url = shouldRewrite ? new URL(CODEX_API_ENDPOINT) : parsed

    const headers = new Headers(init?.headers as HeadersInit)
    if (accountId) {
      headers.set('ChatGPT-Account-Id', accountId)
    }
    headers.set('originator', 'browseros')
    headers.set('OpenAI-Beta', 'responses=experimental')

    // Codex requires stream:true, store:false, and instructions
    let body = init?.body
    if (shouldRewrite && body && typeof body === 'string') {
      try {
        const json = JSON.parse(body)
        json.stream = true
        json.store = false
        if (!json.instructions) {
          json.instructions = 'You are a helpful assistant.'
        }
        body = JSON.stringify(json)
      } catch (err) {
        logger.warn('Failed to inject Codex-required fields into request body', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return fetch(url, { ...init, headers, body })
  }
}
