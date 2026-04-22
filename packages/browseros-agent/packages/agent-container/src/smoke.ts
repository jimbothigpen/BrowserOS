import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import {
  podmanInspectImage,
  podmanLoadArchive,
  podmanRemoveImage,
} from './build'

export interface RoundTripPodmanLoadOptions {
  tarballPath: string
  expectedImage: string
  expectedImageId?: string
  expectedSmokeFingerprint?: string
}

async function maybeDecompressTarball(tarballPath: string): Promise<{
  tarPath: string
  cleanupDir?: string
}> {
  if (!tarballPath.endsWith('.gz')) {
    return { tarPath: tarballPath }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'agent-container-smoke-'))
  const tarPath = join(tempDir, 'image.tar')
  await pipeline(
    createReadStream(tarballPath),
    createGunzip(),
    createWriteStream(tarPath),
  )

  return { tarPath, cleanupDir: tempDir }
}

export async function roundTripPodmanLoad(
  options: RoundTripPodmanLoadOptions,
): Promise<void> {
  if (!options.expectedImageId && !options.expectedSmokeFingerprint) {
    throw new Error(
      'expectedImageId or expectedSmokeFingerprint is required for smoke verification',
    )
  }

  const decompressed = await maybeDecompressTarball(options.tarballPath)

  try {
    await podmanRemoveImage(options.expectedImage).catch(() => {})
    await podmanLoadArchive(decompressed.tarPath)

    const inspection = await podmanInspectImage(options.expectedImage)
    if (
      options.expectedSmokeFingerprint &&
      inspection.smokeFingerprint !== options.expectedSmokeFingerprint
    ) {
      throw new Error(
        `loaded image fingerprint mismatch: expected ${options.expectedSmokeFingerprint}, got ${inspection.smokeFingerprint}`,
      )
    }
    if (
      options.expectedImageId &&
      inspection.imageId !== options.expectedImageId
    ) {
      throw new Error(
        `loaded image ID mismatch: expected ${options.expectedImageId}, got ${inspection.imageId}`,
      )
    }
  } finally {
    await podmanRemoveImage(options.expectedImage).catch(() => {})
    if (decompressed.cleanupDir) {
      await rm(decompressed.cleanupDir, { recursive: true, force: true })
    }
  }
}
