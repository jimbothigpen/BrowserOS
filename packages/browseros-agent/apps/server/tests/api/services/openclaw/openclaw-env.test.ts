/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { buildComposeEnvFile } from '../../../../src/api/services/openclaw/openclaw-env'

describe('buildComposeEnvFile', () => {
  it('pins the default OpenClaw image to 2026.4.12', () => {
    expect(
      buildComposeEnvFile({
        hostHome: '/tmp/openclaw-home',
        timezone: 'UTC',
      }),
    ).toContain('OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.4.12')
  })

  it('respects an explicit image override', () => {
    expect(
      buildComposeEnvFile({
        hostHome: '/tmp/openclaw-home',
        timezone: 'UTC',
        image: 'ghcr.io/openclaw/openclaw:custom',
      }),
    ).toContain('OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:custom')
  })
})
