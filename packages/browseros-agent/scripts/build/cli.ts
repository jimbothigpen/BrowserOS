#!/usr/bin/env bun

import { runCliInstallerUpload } from './cli/upload'

runCliInstallerUpload().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
})
