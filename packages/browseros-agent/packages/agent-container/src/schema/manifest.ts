import { z } from 'zod'

import { ARCHES } from './arch'

export const MANIFEST_SCHEMA_VERSION = 'v1' as const

export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const ociDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const agentArtifactSchema = z.object({
  arch: z.enum(ARCHES),
  filename: z.string().min(1),
  format: z.literal('oci-archive+gzip'),
  compressed_sha256: sha256HexSchema,
  compressed_size_bytes: z.number().int().positive(),
  uncompressed_sha256: sha256HexSchema,
  uncompressed_size_bytes: z.number().int().positive(),
  url: z.string().url(),
})

export const agentManifestSchema = z.object({
  name: z.string().min(1),
  schema: z.literal(MANIFEST_SCHEMA_VERSION),
  build: z.object({
    git_sha: z.string().min(1),
    git_dirty: z.boolean(),
    built_at: z.string().datetime(),
    built_by: z.string().min(1),
    config_sha256: sha256HexSchema,
    podman_versions: z.array(z.string().min(1)).min(1),
  }),
  source: z.object({
    image: z.string().min(1),
    version: z.string().min(1),
    oci_digest: ociDigestSchema,
  }),
  artifacts: z.array(agentArtifactSchema).min(1),
})

export const aggregateEntrySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  oci_digest: ociDigestSchema,
  manifest_url: z.string().url(),
})

export const aggregateManifestSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA_VERSION),
  built_at: z.string().datetime(),
  built_by: z.string().min(1),
  agents: z.array(aggregateEntrySchema).min(1),
})

export type AgentArtifact = z.infer<typeof agentArtifactSchema>
export type AgentManifest = z.infer<typeof agentManifestSchema>
export type AggregateEntry = z.infer<typeof aggregateEntrySchema>
export type AggregateManifest = z.infer<typeof aggregateManifestSchema>

export function parseAgentManifest(raw: unknown): AgentManifest {
  return agentManifestSchema.parse(raw)
}

export function parseAggregateManifest(raw: unknown): AggregateManifest {
  return aggregateManifestSchema.parse(raw)
}
