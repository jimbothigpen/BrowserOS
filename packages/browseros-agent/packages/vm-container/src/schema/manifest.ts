import { z } from 'zod'
import { ARCHES, CALVER_REGEX } from './arch'

export const MANIFEST_SCHEMA_VERSION = 'v1' as const

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/)

export const vmProviderSchema = z.object({
  arch: z.enum(ARCHES),
  filename: z.string().min(1),
  format: z.literal('qcow2+zstd'),
  compressed_sha256: sha256Hex,
  compressed_size_bytes: z.number().int().positive(),
  uncompressed_sha256: sha256Hex,
  uncompressed_size_bytes: z.number().int().positive(),
  base_image_sha256: sha256Hex,
  url: z.string().url(),
})

export const vmManifestSchema = z.object({
  name: z.literal('browseros-vm'),
  version: z.string().regex(CALVER_REGEX),
  schema: z.literal(MANIFEST_SCHEMA_VERSION),
  build: z.object({
    git_sha: z.string().min(1),
    git_dirty: z.boolean(),
    built_at: z.string().min(1),
    built_by: z.string().min(1),
    recipe_sha256: sha256Hex,
  }),
  base_image: z.object({
    distro: z.literal('debian'),
    release: z.string().min(1),
    channel: z.literal('genericcloud'),
    upstream_version: z.string().min(1),
    sha256_url: z.string().url(),
  }),
  packages: z.record(z.string(), z.string()),
  providers: z.array(vmProviderSchema).length(2),
})

export const latestPointerSchema = z.object({
  version: z.string().regex(CALVER_REGEX),
  updated_at: z.string().min(1),
  url: z.string().url(),
})

export type VmProvider = z.infer<typeof vmProviderSchema>
export type VmManifest = z.infer<typeof vmManifestSchema>
export type LatestPointer = z.infer<typeof latestPointerSchema>

export function parseManifest(raw: unknown): VmManifest {
  return vmManifestSchema.parse(raw)
}

export function parseLatestPointer(raw: unknown): LatestPointer {
  return latestPointerSchema.parse(raw)
}
