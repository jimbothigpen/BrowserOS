import type { Arch } from '../schema/arch'
import type { BaseImage } from './base-image'

export interface BuildResult {
  arch: Arch
  version: string
  baseImage: BaseImage
  recipeSha256: string
  rawQcowPath: string
  rawQcowSha256: string
  rawQcowSize: number
  compressedPath: string
  compressedSha256: string
  compressedSize: number
  packages: Record<string, string>
  buildLogPath: string
}

export interface BuildOptions {
  version: string
  arch: Arch
  outputDir: string
  recipePath?: string
  baseImageShaOverride?: string
}
