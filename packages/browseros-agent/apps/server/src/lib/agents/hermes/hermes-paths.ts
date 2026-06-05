/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Host-side path helpers for Hermes per-agent configuration.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBrowserosDir } from '../../browseros-dir'

/** Top-level Hermes state directory. */
export function getHermesHostStateDir(browserosDir?: string): string {
  return join(browserosDir ?? getBrowserosDir(), 'agents', 'hermes')
}

/** Per-agent Hermes harness root. */
export function getHermesHarnessHostDir(browserosDir?: string): string {
  return join(getHermesHostStateDir(browserosDir), 'harness')
}

/**
 * Per-agent home directory on the host. Hermes reads `config.yaml` +
 * `.env` from here; both files are written at agent-create time.
 */
export function getHermesAgentHomeHostDir(input: {
  browserosDir?: string
  agentId: string
}): string {
  return join(
    getHermesHarnessHostDir(input.browserosDir),
    input.agentId,
    'home',
  )
}

/**
 * Write a Hermes per-agent provider config into the on-host home dir.
 *
 * Idempotent: writes always overwrite (last-write-wins). The provider
 * id, env var name, and credentials must be supplied by the caller —
 * Hermes agents always carry their own config; there is no
 * `~/.hermes/` fallback.
 */
export async function writeHermesPerAgentProvider(input: {
  browserosDir?: string
  agentId: string
  providerId: string
  envVarName: string
  apiKey: string
  modelId: string
  baseUrl?: string
}): Promise<void> {
  const home = getHermesAgentHomeHostDir({
    browserosDir: input.browserosDir,
    agentId: input.agentId,
  })
  await mkdir(home, { recursive: true })

  // Hermes' `provider: custom` requires a `base_url` — without one the
  // model loader rejects with `unknown provider 'custom'`. Callers that
  // use a named Hermes provider (e.g. anthropic, openrouter) can omit
  // baseUrl and Hermes resolves the URL itself.
  if (input.providerId === 'custom' && !input.baseUrl) {
    throw new Error(
      'Hermes provider "custom" requires base_url; set HermesProviderMapping.defaultBaseUrl or supply input.baseUrl',
    )
  }
  const yamlLines = [
    'model:',
    `  default: ${JSON.stringify(input.modelId)}`,
    `  provider: ${JSON.stringify(input.providerId)}`,
  ]
  if (input.baseUrl) {
    yamlLines.push(`  base_url: ${JSON.stringify(input.baseUrl)}`)
  }
  yamlLines.push('')
  await writeFile(join(home, 'config.yaml'), yamlLines.join('\n'), {
    mode: 0o600,
  })

  const envLines: string[] = [`${input.envVarName}=${input.apiKey}`, '']
  await writeFile(join(home, '.env'), envLines.join('\n'), { mode: 0o600 })
}
