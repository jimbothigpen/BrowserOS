import { describe, expect, test } from 'bun:test'
import type { VmManifest } from '../src/schema/manifest'
import {
  MANIFEST_SCHEMA_VERSION,
  parseLatestPointer,
  parseManifest,
} from '../src/schema/manifest'

const sha = (c: string): string => c.repeat(64).slice(0, 64)

const validManifest: VmManifest = {
  name: 'browseros-vm',
  version: '2026.04.22-1',
  schema: MANIFEST_SCHEMA_VERSION,
  build: {
    git_sha: 'abc123',
    git_dirty: false,
    built_at: '2026-04-22T00:00:00.000Z',
    built_by: 'operator',
    recipe_sha256: sha('a'),
  },
  base_image: {
    distro: 'debian',
    release: 'bookworm',
    channel: 'genericcloud',
    upstream_version: '20260401-1234',
    sha256_url:
      'https://cloud.debian.org/images/cloud/bookworm/20260401-1234/SHA256SUMS',
  },
  packages: { podman: '4.3.1+ds1-8+deb12u1' },
  providers: [
    {
      arch: 'arm64',
      filename: 'browseros-vm-2026.04.22-1-arm64.qcow2.zst',
      format: 'qcow2+zstd',
      compressed_sha256: sha('b'),
      compressed_size_bytes: 200_000_000,
      uncompressed_sha256: sha('c'),
      uncompressed_size_bytes: 500_000_000,
      base_image_sha256: sha('d'),
      url: 'https://cdn.browseros.com/vm/2026.04.22-1/browseros-vm-2026.04.22-1-arm64.qcow2.zst',
    },
    {
      arch: 'x64',
      filename: 'browseros-vm-2026.04.22-1-x64.qcow2.zst',
      format: 'qcow2+zstd',
      compressed_sha256: sha('e'),
      compressed_size_bytes: 210_000_000,
      uncompressed_sha256: sha('f'),
      uncompressed_size_bytes: 520_000_000,
      base_image_sha256: sha('d'),
      url: 'https://cdn.browseros.com/vm/2026.04.22-1/browseros-vm-2026.04.22-1-x64.qcow2.zst',
    },
  ],
}

describe('parseManifest', () => {
  test('accepts a valid manifest', () => {
    expect(parseManifest(validManifest)).toEqual(validManifest)
  })

  test('rejects bad CalVer', () => {
    expect(() =>
      parseManifest({ ...validManifest, version: '1.2.3' }),
    ).toThrow()
  })

  test('rejects unknown schema version', () => {
    expect(() => parseManifest({ ...validManifest, schema: 'v2' })).toThrow()
  })

  test('rejects short sha256', () => {
    const bad = {
      ...validManifest,
      build: { ...validManifest.build, recipe_sha256: 'tooshort' },
    }
    expect(() => parseManifest(bad)).toThrow()
  })

  test('rejects less than 2 providers', () => {
    const bad = { ...validManifest, providers: [validManifest.providers[0]] }
    expect(() => parseManifest(bad)).toThrow()
  })
})

describe('parseLatestPointer', () => {
  test('accepts valid pointer', () => {
    const pointer = {
      version: '2026.04.22-1',
      updated_at: '2026-04-22T00:00:00.000Z',
      url: 'https://cdn.browseros.com/vm/2026.04.22-1/manifest.json',
    }
    expect(parseLatestPointer(pointer)).toEqual(pointer)
  })

  test('rejects bad CalVer', () => {
    expect(() =>
      parseLatestPointer({
        version: 'latest',
        updated_at: '2026-04-22T00:00:00.000Z',
        url: 'https://cdn.browseros.com/vm/latest/manifest.json',
      }),
    ).toThrow()
  })
})
