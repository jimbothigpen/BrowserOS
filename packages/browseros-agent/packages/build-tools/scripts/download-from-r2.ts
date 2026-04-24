#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createR2Client, getBody, getBucket } from './common/r2'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    key: { type: 'string' },
    out: { type: 'string' },
  },
})

if (!values.key || !values.out) {
  console.error('usage: download -- --key <r2-key> --out <path>')
  process.exit(1)
}

const body = await getBody(createR2Client(), getBucket(), values.key)
if (body === null) {
  throw new Error(
    `R2 key not found: ${values.key}. Publish a full manifest before publishing slices.`,
  )
}

await mkdir(path.dirname(values.out), { recursive: true })
await writeFile(values.out, body)
console.log(`downloaded ${values.key} to ${values.out}`)
