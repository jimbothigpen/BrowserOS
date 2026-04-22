import { describe, expect, it } from 'bun:test'

import {
  parseAgentManifest,
  parseAggregateManifest,
} from '../src/schema/manifest'

function hex(char: string): string {
  return char.repeat(64)
}

describe('schema/manifest', () => {
  it('parses a valid agent manifest', () => {
    const manifest = parseAgentManifest({
      name: 'openclaw',
      schema: 'v1',
      build: {
        git_sha: 'abc123',
        git_dirty: false,
        built_at: '2026-04-22T17:30:00.000Z',
        built_by: 'workflow@refs/heads/dev',
        config_sha256: hex('0'),
        podman_versions: ['podman version 5.8.1'],
      },
      source: {
        image: 'ghcr.io/openclaw/openclaw',
        version: '2026.4.12',
        oci_digest: `sha256:${hex('1')}`,
      },
      artifacts: [
        {
          arch: 'amd64',
          filename: 'openclaw-2026.4.12-amd64.tar.gz',
          format: 'oci-archive+gzip',
          compressed_sha256: hex('2'),
          compressed_size_bytes: 123,
          uncompressed_sha256: hex('3'),
          uncompressed_size_bytes: 456,
          url: 'https://cdn.browseros.com/agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz',
        },
      ],
    })

    expect(manifest.source.version).toBe('2026.4.12')
    expect(manifest.artifacts).toHaveLength(1)
  })

  it('rejects invalid artifact hashes', () => {
    expect(() =>
      parseAgentManifest({
        name: 'openclaw',
        schema: 'v1',
        build: {
          git_sha: 'abc123',
          git_dirty: false,
          built_at: '2026-04-22T17:30:00.000Z',
          built_by: 'workflow@refs/heads/dev',
          config_sha256: hex('0'),
          podman_versions: ['podman version 5.8.1'],
        },
        source: {
          image: 'ghcr.io/openclaw/openclaw',
          version: '2026.4.12',
          oci_digest: `sha256:${hex('1')}`,
        },
        artifacts: [
          {
            arch: 'amd64',
            filename: 'openclaw-2026.4.12-amd64.tar.gz',
            format: 'oci-archive+gzip',
            compressed_sha256: 'bad',
            compressed_size_bytes: 123,
            uncompressed_sha256: hex('3'),
            uncompressed_size_bytes: 456,
            url: 'https://cdn.browseros.com/agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz',
          },
        ],
      }),
    ).toThrow()
  })

  it('parses a valid aggregate manifest', () => {
    const manifest = parseAggregateManifest({
      schema: 'v1',
      built_at: '2026-04-22T17:30:00.000Z',
      built_by: 'workflow@refs/heads/dev',
      agents: [
        {
          name: 'openclaw',
          version: '2026.4.12',
          oci_digest: `sha256:${hex('4')}`,
          manifest_url:
            'https://cdn.browseros.com/agents/openclaw/2026.4.12/manifest.json',
        },
      ],
    })

    expect(manifest.agents[0]?.name).toBe('openclaw')
  })
})
