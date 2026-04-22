import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import type { BuildResult } from '../src/build/types'
import type { Arch } from '../src/schema/arch'
import { publishDisks } from '../src/upload/publish'

// aws-sdk-client-mock's own @smithy/types can lag @aws-sdk/client-s3, so its
// typed signatures reject our command classes at compile time even though
// they work at runtime. `as never` sidesteps the version skew.
const PutCmd = PutObjectCommand as never
const DeleteCmd = DeleteObjectCommand as never
const s3Mock = mockClient(S3Client as never)

const sha = (c: string): string => c.repeat(64).slice(0, 64)

let workDir: string

beforeEach(async () => {
  s3Mock.reset()
  s3Mock.on(PutCmd).resolves({})
  s3Mock.on(DeleteCmd).resolves({})
  workDir = await mkdtemp(path.join(tmpdir(), 'publish-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function makeResult(arch: Arch): Promise<BuildResult> {
  const compressed = path.join(
    workDir,
    `browseros-vm-2026.04.22-1-${arch}.qcow2.zst`,
  )
  await writeFile(compressed, Buffer.from('fake-compressed-data'))
  return {
    arch,
    version: '2026.04.22-1',
    baseImage: {
      distro: 'debian',
      release: 'bookworm',
      channel: 'genericcloud',
      upstreamVersion: '20260401-1234',
      arch,
      url: `https://cloud.debian.org/.../${arch}.qcow2`,
      sha256: sha('d'),
    },
    recipeSha256: sha('a'),
    rawQcowPath: path.join(workDir, `browseros-vm-2026.04.22-1-${arch}.qcow2`),
    rawQcowSha256: sha('b'),
    rawQcowSize: 500_000_000,
    compressedPath: compressed,
    compressedSha256: sha('c'),
    compressedSize: 200_000_000,
    packages: { podman: '4.3.1-1' },
    buildLogPath: path.join(workDir, `build-${arch}.log`),
  }
}

const client = new S3Client({})
const bucket = 'test-bucket'
const version = '2026.04.22-1'

describe('publishDisks', () => {
  test('happy path uploads qcow + sha per arch, then manifest, then latest', async () => {
    const results = {
      arm64: await makeResult('arm64'),
      x64: await makeResult('x64'),
    }
    await publishDisks({ version, results, updateLatest: true, client, bucket })

    const puts = s3Mock.commandCalls(PutCmd)
    const keys = puts.map((c) => c.args[0].input.Key as string)
    expect(keys).toEqual([
      `vm/${version}/browseros-vm-${version}-arm64.qcow2.zst`,
      `vm/${version}/browseros-vm-${version}-arm64.qcow2.zst.sha256`,
      `vm/${version}/browseros-vm-${version}-x64.qcow2.zst`,
      `vm/${version}/browseros-vm-${version}-x64.qcow2.zst.sha256`,
      `vm/${version}/manifest.json`,
      'vm/latest.json',
    ])
    expect(s3Mock.commandCalls(DeleteCmd).length).toBe(0)
  })

  test('updateLatest: false omits latest.json', async () => {
    const results = {
      arm64: await makeResult('arm64'),
      x64: await makeResult('x64'),
    }
    await publishDisks({
      version,
      results,
      updateLatest: false,
      client,
      bucket,
    })
    const keys = s3Mock
      .commandCalls(PutCmd)
      .map((c) => c.args[0].input.Key as string)
    expect(keys).not.toContain('vm/latest.json')
  })

  test('rollback deletes already-uploaded keys on failure', async () => {
    s3Mock.reset()
    let callCount = 0
    s3Mock.on(PutCmd).callsFake(() => {
      callCount += 1
      if (callCount > 2) throw new Error('simulated R2 failure')
      return {}
    })
    s3Mock.on(DeleteCmd).resolves({})

    const results = {
      arm64: await makeResult('arm64'),
      x64: await makeResult('x64'),
    }
    await expect(
      publishDisks({ version, results, updateLatest: true, client, bucket }),
    ).rejects.toThrow(/simulated R2 failure/)

    const deletedKeys = s3Mock
      .commandCalls(DeleteCmd)
      .map((c) => c.args[0].input.Key as string)
      .sort()
    expect(deletedKeys).toEqual([
      `vm/${version}/browseros-vm-${version}-arm64.qcow2.zst`,
      `vm/${version}/browseros-vm-${version}-arm64.qcow2.zst.sha256`,
    ])
  })
})
