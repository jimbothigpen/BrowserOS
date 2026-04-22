#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { BuildResult } from '../src/build/types'
import { type Arch, parseArch } from '../src/schema/arch'
import { publishDisks } from '../src/upload/publish'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: 'string' },
    'artifact-dir': { type: 'string' },
    'update-latest': { type: 'boolean', default: true },
    'no-update-latest': { type: 'boolean', default: false },
  },
})

if (!values.version || !values['artifact-dir']) {
  console.error(
    'usage: bun run upload -- --version <YYYY.MM.DD-N> --artifact-dir <dir> [--no-update-latest]',
  )
  process.exit(1)
}

const results = await loadResults(values['artifact-dir'])
if (Object.keys(results).length === 0) {
  throw new Error(
    `no build-result-*.json files found under ${values['artifact-dir']}`,
  )
}

await publishDisks({
  version: values.version,
  results,
  updateLatest: !values['no-update-latest'],
})

console.log(
  `published ${Object.keys(results).length} arch(es) for version ${values.version}`,
)

async function loadResults(
  dir: string,
): Promise<Partial<Record<Arch, BuildResult>>> {
  const out: Partial<Record<Arch, BuildResult>> = {}
  for (const file of await walkForResults(dir)) {
    const raw = await readFile(file, 'utf8')
    const result = JSON.parse(raw) as BuildResult
    out[parseArch(result.arch)] = resolvePaths(result, path.dirname(file))
  }
  return out
}

async function walkForResults(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkForResults(full)))
    } else if (
      entry.name.startsWith('build-result-') &&
      entry.name.endsWith('.json')
    ) {
      out.push(full)
    }
  }
  return out
}

function resolvePaths(result: BuildResult, dir: string): BuildResult {
  const resolve = (p: string): string =>
    path.isAbsolute(p) ? p : path.join(dir, path.basename(p))
  return {
    ...result,
    rawQcowPath: resolve(result.rawQcowPath),
    compressedPath: resolve(result.compressedPath),
    buildLogPath: resolve(result.buildLogPath),
  }
}
