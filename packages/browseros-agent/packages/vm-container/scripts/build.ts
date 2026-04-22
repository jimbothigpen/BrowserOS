#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildDisk } from '../src/build/orchestrator'
import { parseArch } from '../src/schema/arch'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: 'string' },
    arch: { type: 'string' },
    'output-dir': { type: 'string', default: './dist' },
    'base-image-sha256': { type: 'string' },
  },
})

if (!values.version || !values.arch) {
  console.error(
    'usage: bun run build -- --version <YYYY.MM.DD-N> --arch <arm64|x64> [--output-dir ./dist] [--base-image-sha256 <sha>]',
  )
  process.exit(1)
}

const result = await buildDisk({
  version: values.version,
  arch: parseArch(values.arch),
  outputDir: values['output-dir'] ?? './dist',
  baseImageShaOverride: values['base-image-sha256'],
})

const resultPath = path.join(
  values['output-dir'] ?? './dist',
  `build-result-${result.arch}.json`,
)
await writeFile(resultPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
