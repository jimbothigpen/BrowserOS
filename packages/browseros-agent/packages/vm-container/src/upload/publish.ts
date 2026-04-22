import { execSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { debianSha256SumsUrl } from '../build/base-image'
import type { BuildResult } from '../build/types'
import {
  keyForLatest,
  keyForManifest,
  keyForQcow,
  keyForSha,
  latestPointerSchema,
  MANIFEST_SCHEMA_VERSION,
  qcowFilename,
  type VmManifest,
  type VmProvider,
  vmManifestSchema,
} from '../schema'
import type { Arch } from '../schema/arch'
import { createR2Client, getBucket, getCdnBaseUrl } from './r2-client'

export interface PublishOptions {
  version: string
  results: Partial<Record<Arch, BuildResult>>
  updateLatest: boolean
  cdnBaseUrl?: string
  client?: S3Client
  bucket?: string
}

export async function publishDisks(opts: PublishOptions): Promise<void> {
  const archs = Object.keys(opts.results) as Arch[]
  if (archs.length === 0) throw new Error('publishDisks: no results supplied')
  const client = opts.client ?? createR2Client()
  const bucket = opts.bucket ?? getBucket()
  const cdnBase = opts.cdnBaseUrl ?? getCdnBaseUrl()
  const uploaded: string[] = []

  try {
    const providers: VmProvider[] = []
    let reference: BuildResult | undefined
    for (const arch of archs) {
      const result = opts.results[arch]
      if (!result) throw new Error(`missing BuildResult for arch ${arch}`)
      reference ??= result
      const qcowKey = keyForQcow(opts.version, arch)
      const shaKey = keyForSha(opts.version, arch)
      await uploadFile(client, bucket, qcowKey, result.compressedPath)
      uploaded.push(qcowKey)
      await uploadBody(
        client,
        bucket,
        shaKey,
        `${result.compressedSha256}  ${qcowFilename(opts.version, arch)}\n`,
      )
      uploaded.push(shaKey)
      providers.push({
        arch,
        filename: qcowFilename(opts.version, arch),
        format: 'qcow2+zstd',
        compressed_sha256: result.compressedSha256,
        compressed_size_bytes: result.compressedSize,
        uncompressed_sha256: result.rawQcowSha256,
        uncompressed_size_bytes: result.rawQcowSize,
        base_image_sha256: result.baseImage.sha256,
        url: `${cdnBase}/${qcowKey}`,
      })
    }

    if (!reference)
      throw new Error('publishDisks: no results yielded a reference build')
    const manifest = buildManifest(opts.version, reference, providers)
    const manifestKey = keyForManifest(opts.version)
    await uploadBody(
      client,
      bucket,
      manifestKey,
      JSON.stringify(manifest, null, 2),
    )
    uploaded.push(manifestKey)

    if (opts.updateLatest) {
      const pointer = latestPointerSchema.parse({
        version: opts.version,
        updated_at: new Date().toISOString(),
        url: `${cdnBase}/${manifestKey}`,
      })
      const latestKey = keyForLatest()
      await uploadBody(
        client,
        bucket,
        latestKey,
        JSON.stringify(pointer, null, 2),
      )
      uploaded.push(latestKey)
    }
  } catch (err) {
    await rollback(client, bucket, uploaded)
    throw err
  }
}

function buildManifest(
  version: string,
  reference: BuildResult,
  providers: VmProvider[],
): VmManifest {
  const manifest = {
    name: 'browseros-vm' as const,
    version,
    schema: MANIFEST_SCHEMA_VERSION,
    build: {
      git_sha: gitSha(),
      git_dirty: gitDirty(),
      built_at: new Date().toISOString(),
      built_by: builtBy(),
      recipe_sha256: reference.recipeSha256,
    },
    base_image: {
      distro: 'debian' as const,
      release: reference.baseImage.release,
      channel: 'genericcloud' as const,
      upstream_version: reference.baseImage.upstreamVersion,
      sha256_url: debianSha256SumsUrl(reference.baseImage.upstreamVersion),
    },
    packages: reference.packages,
    providers,
  }
  return vmManifestSchema.parse(manifest)
}

async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  localPath: string,
): Promise<void> {
  const body = await readFile(localPath)
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
  )
}

async function uploadBody(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
  )
}

async function rollback(
  client: S3Client,
  bucket: string,
  keys: string[],
): Promise<void> {
  await Promise.allSettled(
    keys.map((key) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    ),
  )
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function gitDirty(): boolean {
  try {
    return (
      execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0
    )
  } catch {
    return false
  }
}

function builtBy(): string {
  const workflow = process.env.GITHUB_WORKFLOW
  const ref = process.env.GITHUB_REF
  if (workflow && ref) return `${workflow}@${ref}`
  return process.env.USER ?? 'unknown'
}
