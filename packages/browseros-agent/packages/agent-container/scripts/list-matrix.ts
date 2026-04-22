#!/usr/bin/env bun

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { expandMatrix, readAgentsConfig } from '../src/catalog'

const packageRoot = resolve(import.meta.dir, '..')
const recipePath = resolve(packageRoot, 'recipe', 'agents.json')

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log('Usage: bun run list-matrix [--agent <name>]')
  process.exit(0)
}

const config = await readAgentsConfig(recipePath)
const include = expandMatrix(config, { agent: values.agent })

if (include.length === 0) {
  throw new Error(
    values.agent
      ? `no agents matched filter: ${values.agent}`
      : 'recipe/agents.json produced an empty matrix',
  )
}

console.log(JSON.stringify({ include }))
