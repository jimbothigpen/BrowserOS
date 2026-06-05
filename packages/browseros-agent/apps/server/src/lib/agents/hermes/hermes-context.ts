/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir } from 'node:fs/promises'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx/agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx/agent-common'
import { getHermesAgentHomeHostDir } from './hermes-paths'

/** Prepares Hermes as a host process with a per-agent HERMES_HOME. */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)
  const hermesAgentHome = getHermesAgentHomeHostDir({
    browserosDir: input.browserosDir,
    agentId: input.agent.id,
  })
  await mkdir(hermesAgentHome, { recursive: true })

  return finishBrowserosManagedContext({
    ...common,
    commandEnv: {
      HERMES_HOME: hermesAgentHome,
    },
  })
}
