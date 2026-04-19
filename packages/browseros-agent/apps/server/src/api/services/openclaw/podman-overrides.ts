/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Persistence for user-supplied Podman runtime overrides.
 * Temporary escape hatch so users can point BrowserOS at their own Podman
 * (e.g. `brew install podman`) when the bundled runtime doesn't resolve helpers.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface PodmanOverrides {
  podmanPath: string | null
}

const OVERRIDES_FILE_NAME = 'podman-overrides.json'

export function getPodmanOverridesPath(openclawDir: string): string {
  return join(openclawDir, OVERRIDES_FILE_NAME)
}

export async function loadPodmanOverrides(
  openclawDir: string,
): Promise<PodmanOverrides> {
  const overridesPath = getPodmanOverridesPath(openclawDir)
  if (!existsSync(overridesPath)) return { podmanPath: null }
  try {
    const parsed = JSON.parse(
      await readFile(overridesPath, 'utf-8'),
    ) as Partial<PodmanOverrides>
    return {
      podmanPath:
        typeof parsed.podmanPath === 'string' && parsed.podmanPath.length > 0
          ? parsed.podmanPath
          : null,
    }
  } catch {
    return { podmanPath: null }
  }
}

export async function savePodmanOverrides(
  openclawDir: string,
  overrides: PodmanOverrides,
): Promise<void> {
  await mkdir(openclawDir, { recursive: true })
  await writeFile(
    getPodmanOverridesPath(openclawDir),
    `${JSON.stringify(overrides, null, 2)}\n`,
  )
}
