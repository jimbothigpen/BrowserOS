#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { createR2Client, getBucket, putBody, putFile } from './common/r2'
import { sha256File } from './common/sha256'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    file: { type: 'string' },
    key: { type: 'string' },
    'content-type': { type: 'string' },
    'sidecar-sha': { type: 'boolean' },
  },
})

if (!values.file || !values.key) {
  throw new Error('--file and --key required')
}

const contentType = values['content-type'] ?? 'application/octet-stream'
const client = createR2Client()
const bucket = getBucket()

try {
  await putFile(client, bucket, values.key, values.file, contentType)
  console.log(`uploaded ${values.file} to ${bucket}/${values.key}`)

  if (values['sidecar-sha']) {
    const sha = await sha256File(values.file)
    const filename = values.file.split('/').pop() ?? values.file
    await putBody(
      client,
      bucket,
      `${values.key}.sha256`,
      `${sha}  ${filename}\n`,
      'text/plain; charset=utf-8',
    )
    console.log(`uploaded sha256 to ${bucket}/${values.key}.sha256`)
  }
} finally {
  client.destroy()
}
