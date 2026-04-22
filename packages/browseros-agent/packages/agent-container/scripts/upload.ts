#!/usr/bin/env bun

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { loadBuildResult } from '../src/build'
import { publishAgents } from '../src/publish'

async function findBuildResultPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths: string[] = []

  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await findBuildResultPaths(path)))
      continue
    }

    if (entry.isFile() && entry.name === 'build-result.json') {
      paths.push(path)
    }
  }

  return paths.sort()
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'artifact-dir': { type: 'string' },
    'update-aggregate': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(
    'Usage: bun run upload -- --artifact-dir <path> [--update-aggregate]',
  )
  process.exit(0)
}

if (!values['artifact-dir']) {
  throw new Error('--artifact-dir is required')
}

const artifactDir = resolve(values['artifact-dir'])
const buildResultPaths = await findBuildResultPaths(artifactDir)
if (buildResultPaths.length === 0) {
  throw new Error(`no build-result.json files found under ${artifactDir}`)
}

const buildResults = await Promise.all(
  buildResultPaths.map((path) => loadBuildResult(path)),
)

await publishAgents({
  buildResults,
  updateAggregate: Boolean(values['update-aggregate']),
})
