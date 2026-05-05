/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx-agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx-agent-common'

const HERMES_GLOBAL_HOME = join(homedir(), '.hermes')
// Files we copy from the user's global Hermes install into each per-agent
// HERMES_HOME on first use. Hermes owns them thereafter; we only seed when
// missing so a re-prepare won't clobber edits the agent has made.
const HERMES_SEED_FILES = ['config.yaml', '.env', 'auth.json'] as const

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function seedHermesHomeFromGlobal(agentHome: string): Promise<void> {
  if (!(await pathExists(HERMES_GLOBAL_HOME))) return
  await mkdir(agentHome, { recursive: true })
  for (const file of HERMES_SEED_FILES) {
    const src = join(HERMES_GLOBAL_HOME, file)
    const dest = join(agentHome, file)
    if (await pathExists(dest)) continue
    if (!(await pathExists(src))) continue
    await copyFile(src, dest)
  }
}

/** Prepares Hermes with a per-agent HERMES_HOME under the BrowserOS-managed agent home. */
export async function prepareHermesContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const common = await prepareBrowserosManagedContext(input)
  await seedHermesHomeFromGlobal(common.paths.agentHome)
  return finishBrowserosManagedContext({
    ...common,
    commandEnv: {
      HERMES_HOME: common.paths.agentHome,
    },
  })
}
