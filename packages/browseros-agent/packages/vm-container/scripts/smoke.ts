#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { bootAndProbe } from '../src/smoke/lima-boot'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    qcow: { type: 'string' },
    limactl: { type: 'string' },
  },
})

if (!values.qcow) {
  console.error(
    'usage: bun run smoke -- --qcow <path.qcow2.zst> [--limactl /usr/local/bin/limactl]',
  )
  process.exit(1)
}

await bootAndProbe(values.qcow, { limactlPath: values.limactl })
console.log('smoke test passed')
