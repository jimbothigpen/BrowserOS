import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'

import type { BuildResult } from '../src/build'
import { publishAgents } from '../src/publish'

const tempDirs: string[] = []

function sha(char: string): string {
  return char.repeat(64)
}

async function createBuildResult(
  root: string,
  arch: 'amd64' | 'arm64',
  overrides: Partial<BuildResult> = {},
): Promise<BuildResult> {
  const dir = join(root, arch)
  await mkdir(dir, { recursive: true })
  const tarballPath = join(dir, `openclaw-2026.4.12-${arch}.tar.gz`)
  const tarballShaPath = `${tarballPath}.sha256`
  await writeFile(tarballPath, `${arch}-tarball`, 'utf8')
  await writeFile(
    tarballShaPath,
    `${sha(arch === 'amd64' ? 'a' : 'b')}  file\n`,
    'utf8',
  )

  return {
    name: 'openclaw',
    publishAs: 'openclaw',
    image: 'ghcr.io/openclaw/openclaw',
    version: '2026.4.12',
    arch,
    sourceOciDigest: `sha256:${sha('c')}`,
    imageId: `sha256:${sha(arch === 'amd64' ? 'd' : 'e')}`,
    smokeFingerprint: sha(arch === 'amd64' ? '6' : '7'),
    filename: `openclaw-2026.4.12-${arch}.tar.gz`,
    tarballPath,
    tarballShaPath,
    compressedSha256: sha(arch === 'amd64' ? '1' : '2'),
    compressedSizeBytes: 100,
    uncompressedSha256: sha(arch === 'amd64' ? '3' : '4'),
    uncompressedSizeBytes: 200,
    podmanVersion: 'podman version 5.8.1',
    builtAt: '2026-04-22T17:30:00.000Z',
    builtBy: 'workflow@refs/heads/dev',
    gitSha: 'abc123',
    gitDirty: false,
    configSha256: sha('5'),
    ...overrides,
  }
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-container-publish-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('publish', () => {
  it('uploads version manifests and updates aggregate last', async () => {
    const root = await createTempDir()
    const buildResults = await Promise.all([
      createBuildResult(root, 'amd64'),
      createBuildResult(root, 'arm64'),
    ])
    const puts: Array<{ key: string; body: unknown }> = []

    const client = {
      send: async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          throw { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }
        }
        if (command instanceof PutObjectCommand) {
          puts.push({
            key: String(command.input.Key),
            body: command.input.Body,
          })
          return {}
        }
        if (command instanceof DeleteObjectCommand) {
          return {}
        }
        throw new Error('unexpected command')
      },
      destroy: () => {},
    } as unknown as S3Client

    await publishAgents({
      buildResults,
      updateAggregate: true,
      bucket: 'test-bucket',
      cdnBaseURL: 'https://cdn.example.com',
      client,
      now: () => new Date('2026-04-22T18:00:00.000Z'),
    })

    expect(puts.map((entry) => entry.key)).toEqual([
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz',
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz.sha256',
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-arm64.tar.gz',
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-arm64.tar.gz.sha256',
      'agents/openclaw/2026.4.12/manifest.json',
      'agents/manifest.json',
    ])

    const versionManifest = JSON.parse(
      String(puts.find((entry) => entry.key.endsWith('/manifest.json'))?.body),
    )
    expect(versionManifest.source.oci_digest).toBe(`sha256:${sha('c')}`)
    expect(versionManifest.artifacts[0].url).toBe(
      'https://cdn.example.com/agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz',
    )

    const aggregateManifest = JSON.parse(String(puts.at(-1)?.body))
    expect(aggregateManifest.agents).toEqual([
      {
        name: 'openclaw',
        version: '2026.4.12',
        oci_digest: `sha256:${sha('c')}`,
        manifest_url:
          'https://cdn.example.com/agents/openclaw/2026.4.12/manifest.json',
      },
    ])
  })

  it('rolls back uploaded keys when a later upload fails', async () => {
    const root = await createTempDir()
    const buildResults = [await createBuildResult(root, 'amd64')]
    const deleted: string[] = []

    const client = {
      send: async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          throw { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }
        }
        if (command instanceof PutObjectCommand) {
          if (String(command.input.Key).endsWith('/manifest.json')) {
            throw new Error('manifest upload failed')
          }
          return {}
        }
        if (command instanceof DeleteObjectCommand) {
          deleted.push(String(command.input.Key))
          return {}
        }
        throw new Error('unexpected command')
      },
      destroy: () => {},
    } as unknown as S3Client

    await expect(
      publishAgents({
        buildResults,
        updateAggregate: true,
        bucket: 'test-bucket',
        client,
      }),
    ).rejects.toThrow('manifest upload failed')

    expect(deleted).toEqual([
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz.sha256',
      'agents/openclaw/2026.4.12/openclaw-2026.4.12-amd64.tar.gz',
    ])
  })

  it('merges new entries into an existing aggregate manifest', async () => {
    const root = await createTempDir()
    const buildResults = [await createBuildResult(root, 'amd64')]
    const puts: Array<{ key: string; body: unknown }> = []

    const client = {
      send: async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          return {
            Body: {
              transformToByteArray: async () =>
                new TextEncoder().encode(
                  JSON.stringify({
                    schema: 'v1',
                    built_at: '2026-04-21T00:00:00.000Z',
                    built_by: 'previous',
                    agents: [
                      {
                        name: 'claude-code',
                        version: '1.0.0',
                        oci_digest: `sha256:${sha('9')}`,
                        manifest_url:
                          'https://cdn.example.com/agents/claude-code/1.0.0/manifest.json',
                      },
                      {
                        name: 'openclaw',
                        version: '2026.4.11',
                        oci_digest: `sha256:${sha('8')}`,
                        manifest_url:
                          'https://cdn.example.com/agents/openclaw/2026.4.11/manifest.json',
                      },
                    ],
                  }),
                ),
            },
          }
        }
        if (command instanceof PutObjectCommand) {
          puts.push({
            key: String(command.input.Key),
            body: command.input.Body,
          })
          return {}
        }
        if (command instanceof DeleteObjectCommand) {
          return {}
        }
        throw new Error('unexpected command')
      },
      destroy: () => {},
    } as unknown as S3Client

    await publishAgents({
      buildResults,
      updateAggregate: true,
      bucket: 'test-bucket',
      cdnBaseURL: 'https://cdn.example.com',
      client,
      now: () => new Date('2026-04-22T18:00:00.000Z'),
    })

    const aggregateManifest = JSON.parse(String(puts.at(-1)?.body))
    expect(aggregateManifest.agents).toEqual([
      {
        name: 'claude-code',
        version: '1.0.0',
        oci_digest: `sha256:${sha('9')}`,
        manifest_url:
          'https://cdn.example.com/agents/claude-code/1.0.0/manifest.json',
      },
      {
        name: 'openclaw',
        version: '2026.4.12',
        oci_digest: `sha256:${sha('c')}`,
        manifest_url:
          'https://cdn.example.com/agents/openclaw/2026.4.12/manifest.json',
      },
    ])
  })

  it('records distinct podman versions across arches', async () => {
    const root = await createTempDir()
    const buildResults = await Promise.all([
      createBuildResult(root, 'amd64', {
        podmanVersion: 'podman version 5.8.1',
      }),
      createBuildResult(root, 'arm64', {
        podmanVersion: 'podman version 5.9.0',
      }),
    ])
    const puts: Array<{ key: string; body: unknown }> = []

    const client = {
      send: async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          throw { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }
        }
        if (command instanceof PutObjectCommand) {
          puts.push({
            key: String(command.input.Key),
            body: command.input.Body,
          })
          return {}
        }
        if (command instanceof DeleteObjectCommand) {
          return {}
        }
        throw new Error('unexpected command')
      },
      destroy: () => {},
    } as unknown as S3Client

    await publishAgents({
      buildResults,
      updateAggregate: false,
      bucket: 'test-bucket',
      client,
    })

    const versionManifest = JSON.parse(
      String(puts.find((entry) => entry.key.endsWith('/manifest.json'))?.body),
    )
    expect(versionManifest.build.podman_versions).toEqual([
      'podman version 5.8.1',
      'podman version 5.9.0',
    ])
  })
})
