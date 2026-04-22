import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'

import type { BuildResult } from './build'
import { ARCHES } from './schema/arch'
import {
  type AgentManifest,
  type AggregateEntry,
  type AggregateManifest,
  agentManifestSchema,
  aggregateManifestSchema,
} from './schema/manifest'
import {
  keyForAggregateManifest,
  keyForSha,
  keyForTarball,
  keyForVersionManifest,
} from './schema/r2-keys'

const CDN_BASE_URL =
  process.env.R2_PUBLIC_BASE_URL ?? 'https://cdn.browseros.com'
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const SHA_CONTENT_TYPE = 'text/plain; charset=utf-8'

export interface PublishOptions {
  buildResults: BuildResult[]
  updateAggregate: boolean
  bucket?: string
  cdnBaseURL?: string
  client?: S3Client
  now?: () => Date
}

interface ResultGroup {
  name: string
  publishAs: string
  image: string
  version: string
  sourceOciDigest: string
  podmanVersions: string[]
  gitSha: string
  gitDirty: boolean
  configSha256: string
  builtBy: string
  results: BuildResult[]
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`missing required env var: ${name}`)
  }

  return value
}

function createR2Client(): S3Client {
  const config: S3ClientConfig = {
    region: 'auto',
    endpoint: `https://${requiredEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  }

  return new S3Client(config)
}

function getBucket(): string {
  return requiredEnv('R2_BUCKET')
}

async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  path: string,
  contentType = 'application/gzip',
): Promise<void> {
  const { size } = await stat(path)
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(path),
      ContentLength: size,
      ContentType: contentType,
    }),
  )
}

async function uploadBody(
  client: S3Client,
  bucket: string,
  key: string,
  body: string | Uint8Array,
  contentType = JSON_CONTENT_TYPE,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

async function deleteObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )
}

function keyForGroup(name: string, version: string): string {
  return `${name}:${version}`
}

function compareByArch(left: BuildResult, right: BuildResult): number {
  return ARCHES.indexOf(left.arch) - ARCHES.indexOf(right.arch)
}

function cdnUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${key}`
}

function createManifestForGroup(
  group: ResultGroup,
  builtAt: string,
  cdnBaseURL: string,
): AgentManifest {
  return agentManifestSchema.parse({
    name: group.name,
    schema: 'v1',
    build: {
      git_sha: group.gitSha,
      git_dirty: group.gitDirty,
      built_at: builtAt,
      built_by: group.builtBy,
      config_sha256: group.configSha256,
      podman_versions: group.podmanVersions,
    },
    source: {
      image: group.image,
      version: group.version,
      oci_digest: group.sourceOciDigest,
    },
    artifacts: [...group.results].sort(compareByArch).map((result) => {
      const key = keyForTarball(
        result.name,
        result.version,
        result.arch,
        result.publishAs,
      )
      return {
        arch: result.arch,
        filename: result.filename,
        format: 'oci-archive+gzip',
        compressed_sha256: result.compressedSha256,
        compressed_size_bytes: result.compressedSizeBytes,
        uncompressed_sha256: result.uncompressedSha256,
        uncompressed_size_bytes: result.uncompressedSizeBytes,
        url: cdnUrl(cdnBaseURL, key),
      }
    }),
  })
}

function mergeAggregateEntries(
  existing: AggregateEntry[],
  nextEntries: AggregateEntry[],
  builtAt: string,
  builtBy: string,
): AggregateManifest {
  const merged = new Map<string, AggregateEntry>()

  for (const entry of existing) {
    merged.set(entry.name, entry)
  }
  for (const entry of nextEntries) {
    merged.set(entry.name, entry)
  }

  return aggregateManifestSchema.parse({
    schema: 'v1',
    built_at: builtAt,
    built_by: builtBy,
    agents: [...merged.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  })
}

function buildAggregateEntries(
  groups: ResultGroup[],
  cdnBaseURL: string,
): AggregateEntry[] {
  return groups
    .map((group) => ({
      name: group.name,
      version: group.version,
      oci_digest: group.sourceOciDigest,
      manifest_url: cdnUrl(
        cdnBaseURL,
        keyForVersionManifest(group.name, group.version),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function buildGroup(results: BuildResult[]): ResultGroup {
  const [firstResult, ...rest] = results
  if (!firstResult) {
    throw new Error('cannot publish an empty build result group')
  }

  for (const result of rest) {
    if (result.name !== firstResult.name) {
      throw new Error('mixed agent names in publish group')
    }
    if (result.publishAs !== firstResult.publishAs) {
      throw new Error('mixed publishAs values in publish group')
    }
    if (result.image !== firstResult.image) {
      throw new Error('mixed source images in publish group')
    }
    if (result.version !== firstResult.version) {
      throw new Error('mixed versions in publish group')
    }
    if (result.sourceOciDigest !== firstResult.sourceOciDigest) {
      throw new Error('mixed source OCI digests in publish group')
    }
    if (
      result.gitSha !== firstResult.gitSha ||
      result.gitDirty !== firstResult.gitDirty
    ) {
      throw new Error('mixed git metadata in publish group')
    }
    if (result.configSha256 !== firstResult.configSha256) {
      throw new Error('mixed recipe config hashes in publish group')
    }
    if (result.builtBy !== firstResult.builtBy) {
      throw new Error('mixed build provenance in publish group')
    }
  }

  const podmanVersions = [
    ...new Set(results.map((result) => result.podmanVersion)),
  ].sort()

  return {
    name: firstResult.name,
    publishAs: firstResult.publishAs,
    image: firstResult.image,
    version: firstResult.version,
    sourceOciDigest: firstResult.sourceOciDigest,
    podmanVersions,
    gitSha: firstResult.gitSha,
    gitDirty: firstResult.gitDirty,
    configSha256: firstResult.configSha256,
    builtBy: firstResult.builtBy,
    results: [...results].sort(compareByArch),
  }
}

function groupByAgentVersion(buildResults: BuildResult[]): ResultGroup[] {
  const grouped = new Map<string, BuildResult[]>()

  for (const result of buildResults) {
    const key = keyForGroup(result.name, result.version)
    const existing = grouped.get(key)
    if (existing) {
      existing.push(result)
      continue
    }
    grouped.set(key, [result])
  }

  return [...grouped.values()]
    .map((results) => buildGroup(results))
    .sort((left, right) => left.name.localeCompare(right.name))
}

async function readBodyAsString(body: unknown): Promise<string> {
  const withTransform = body as {
    transformToByteArray?: () => Promise<Uint8Array>
  }
  if (!withTransform?.transformToByteArray) {
    throw new Error('R2 response body is not readable')
  }

  const bytes = await withTransform.transformToByteArray()
  return new TextDecoder().decode(bytes)
}

async function readExistingAggregateEntries(
  client: S3Client,
  bucket: string,
): Promise<AggregateEntry[]> {
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: keyForAggregateManifest(),
      }),
    )
    const body = await readBodyAsString(response.Body)
    const parsed = aggregateManifestSchema.parse(JSON.parse(body))
    return parsed.agents
  } catch (error) {
    const maybeError = error as {
      name?: string
      $metadata?: { httpStatusCode?: number }
    }
    if (
      maybeError?.name === 'NoSuchKey' ||
      maybeError?.$metadata?.httpStatusCode === 404
    ) {
      return []
    }
    throw error
  }
}

async function rollbackKeys(
  client: S3Client,
  bucket: string,
  uploadedKeys: string[],
): Promise<void> {
  await Promise.allSettled(
    [...uploadedKeys].reverse().map((key) => deleteObject(client, bucket, key)),
  )
}

export async function publishAgents(options: PublishOptions): Promise<void> {
  if (options.buildResults.length === 0) {
    throw new Error('buildResults must not be empty')
  }

  const client = options.client ?? createR2Client()
  const bucket = options.bucket ?? getBucket()
  const cdnBaseURL = options.cdnBaseURL ?? CDN_BASE_URL
  const now = options.now ?? (() => new Date())
  const uploadedKeys: string[] = []

  try {
    const groups = groupByAgentVersion(options.buildResults)
    const builtAt = now().toISOString()

    for (const group of groups) {
      for (const result of group.results) {
        const tarKey = keyForTarball(
          result.name,
          result.version,
          result.arch,
          result.publishAs,
        )
        const shaKey = keyForSha(
          result.name,
          result.version,
          result.arch,
          result.publishAs,
        )

        await uploadFile(client, bucket, tarKey, result.tarballPath)
        uploadedKeys.push(tarKey)

        await uploadFile(
          client,
          bucket,
          shaKey,
          result.tarballShaPath,
          SHA_CONTENT_TYPE,
        )
        uploadedKeys.push(shaKey)
      }

      const manifest = createManifestForGroup(group, builtAt, cdnBaseURL)
      const manifestKey = keyForVersionManifest(group.name, group.version)
      await uploadBody(
        client,
        bucket,
        manifestKey,
        `${JSON.stringify(manifest, null, 2)}\n`,
        JSON_CONTENT_TYPE,
      )
      uploadedKeys.push(manifestKey)
    }

    if (options.updateAggregate) {
      const existingEntries = await readExistingAggregateEntries(client, bucket)
      const aggregate = mergeAggregateEntries(
        existingEntries,
        buildAggregateEntries(groups, cdnBaseURL),
        builtAt,
        groups[0]?.builtBy ?? 'unknown',
      )
      const aggregateKey = keyForAggregateManifest()
      await uploadBody(
        client,
        bucket,
        aggregateKey,
        `${JSON.stringify(aggregate, null, 2)}\n`,
        JSON_CONTENT_TYPE,
      )
      uploadedKeys.push(aggregateKey)
    }
  } catch (error) {
    await rollbackKeys(client, bucket, uploadedKeys)
    throw error
  } finally {
    if (!options.client) {
      client.destroy()
    }
  }
}
