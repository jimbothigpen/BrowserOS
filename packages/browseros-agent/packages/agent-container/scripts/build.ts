#!/usr/bin/env bun

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { buildTarball } from '../src/build'
import { readAgentsConfig } from '../src/catalog'
import { parseArch } from '../src/schema/arch'

const packageRoot = resolve(import.meta.dir, '..')
const recipePath = resolve(packageRoot, 'recipe', 'agents.json')

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: { type: 'string' },
    version: { type: 'string' },
    arch: { type: 'string' },
    'output-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(
    'Usage: bun run build -- --agent <name> --arch <amd64|arm64> --output-dir <path> [--version <override>]',
  )
  process.exit(0)
}

if (!values.agent || !values.arch || !values['output-dir']) {
  throw new Error('--agent, --arch, and --output-dir are required')
}

const config = await readAgentsConfig(recipePath)
const selected = config.agents.find((agent) => agent.name === values.agent)
if (!selected) {
  throw new Error(`unknown agent: ${values.agent}`)
}

const result = await buildTarball({
  agent: {
    ...selected,
    version: values.version ?? selected.version,
  },
  arch: parseArch(values.arch),
  outputDir: values['output-dir'],
  recipePath,
})

console.log(JSON.stringify(result, null, 2))
