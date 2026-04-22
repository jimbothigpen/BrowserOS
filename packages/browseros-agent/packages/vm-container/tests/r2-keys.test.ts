import { describe, expect, test } from 'bun:test'
import {
  keyForLatest,
  keyForManifest,
  keyForQcow,
  keyForSha,
  qcowFilename,
  R2_VM_PREFIX,
} from '../src/schema/r2-keys'

describe('R2 key helpers', () => {
  const version = '2026.04.22-1'

  test('qcowFilename shape', () => {
    expect(qcowFilename(version, 'arm64')).toBe(
      'browseros-vm-2026.04.22-1-arm64.qcow2.zst',
    )
    expect(qcowFilename(version, 'x64')).toBe(
      'browseros-vm-2026.04.22-1-x64.qcow2.zst',
    )
  })

  test('keyForQcow is versioned', () => {
    expect(keyForQcow(version, 'arm64')).toBe(
      `${R2_VM_PREFIX}/${version}/browseros-vm-${version}-arm64.qcow2.zst`,
    )
  })

  test('keyForSha appends .sha256', () => {
    expect(keyForSha(version, 'x64')).toBe(
      `${keyForQcow(version, 'x64')}.sha256`,
    )
  })

  test('keyForManifest + keyForLatest', () => {
    expect(keyForManifest(version)).toBe(
      `${R2_VM_PREFIX}/${version}/manifest.json`,
    )
    expect(keyForLatest()).toBe(`${R2_VM_PREFIX}/latest.json`)
  })
})
