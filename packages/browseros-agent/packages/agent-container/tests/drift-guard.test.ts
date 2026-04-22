import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readAgentsConfig } from '../src/catalog'

const packageRoot = resolve(import.meta.dir, '..')
const recipePath = resolve(packageRoot, 'recipe', 'agents.json')
const runtimePath = resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'apps',
  'server',
  'src',
  'api',
  'services',
  'openclaw',
  'openclaw-service.ts',
)

describe('OpenClaw drift guard', () => {
  it('keeps recipe/agents.json in sync with the runtime image pin', async () => {
    const [config, runtimeSource] = await Promise.all([
      readAgentsConfig(recipePath),
      readFile(runtimePath, 'utf8'),
    ])

    const openclaw = config.agents.find((agent) => agent.name === 'openclaw')
    expect(openclaw).toBeDefined()

    const match = runtimeSource.match(
      /return process\.env\.OPENCLAW_IMAGE \|\| '([^']+)'/,
    )
    expect(match?.[1]).toBeDefined()

    const recipeImage = `${openclaw?.image}:${openclaw?.version}`
    expect(recipeImage).toBe(match?.[1], {
      message: `OpenClaw image drifted between ${recipePath} and ${runtimePath}`,
    })
  })
})
