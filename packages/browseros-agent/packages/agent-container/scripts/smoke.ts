#!/usr/bin/env bun

import { parseArgs } from 'node:util'

import { roundTripPodmanLoad } from '../src/smoke'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    tarball: { type: 'string' },
    'expected-image': { type: 'string' },
    'expected-image-id': { type: 'string' },
    'expected-fingerprint': { type: 'string' },
    'expected-digest': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(
    'Usage: bun run smoke -- --tarball <path> --expected-image <ref> [--expected-fingerprint <sha256-hex>] [--expected-image-id <sha256:...>]',
  )
  process.exit(0)
}

const expectedImageId = values['expected-image-id'] ?? values['expected-digest']
if (
  !values.tarball ||
  !values['expected-image'] ||
  (!expectedImageId && !values['expected-fingerprint'])
) {
  throw new Error(
    '--tarball, --expected-image, and one verification flag are required',
  )
}

await roundTripPodmanLoad({
  tarballPath: values.tarball,
  expectedImage: values['expected-image'],
  expectedImageId,
  expectedSmokeFingerprint: values['expected-fingerprint'],
})
