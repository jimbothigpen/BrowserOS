import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log } from '../log'
import { createR2Client, joinObjectKey, uploadFileToObject } from '../server/r2'
import { loadCliUploadConfig } from './config'

const CDN_BASE_URL = 'https://cdn.browseros.com'

const INSTALLERS = [
  {
    filePath: join('apps', 'cli', 'scripts', 'install.sh'),
    objectName: 'install.sh',
    contentType: 'text/x-shellscript; charset=utf-8',
  },
  {
    filePath: join('apps', 'cli', 'scripts', 'install.ps1'),
    objectName: 'install.ps1',
    contentType: 'text/plain; charset=utf-8',
  },
] as const

export async function runCliInstallerUpload(): Promise<void> {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  process.chdir(rootDir)
  await uploadCliInstallers(rootDir)
}

export async function uploadCliInstallers(rootDir: string): Promise<void> {
  const { r2 } = loadCliUploadConfig(rootDir)
  const client = createR2Client(r2)

  log.header('Uploading BrowserOS CLI installer scripts')

  try {
    for (const installer of INSTALLERS) {
      const absolutePath = join(rootDir, installer.filePath)
      if (!existsSync(absolutePath)) {
        throw new Error(`Installer script not found: ${installer.filePath}`)
      }

      const objectKey = joinObjectKey(r2.uploadPrefix, installer.objectName)
      log.step(`Uploading ${installer.filePath}`)
      await uploadFileToObject(client, r2, objectKey, absolutePath, {
        contentType: installer.contentType,
      })
      log.success(`Uploaded ${objectKey}`)
      log.info(`${CDN_BASE_URL}/${objectKey}`)
    }

    log.done('CLI installer upload completed')
  } finally {
    client.destroy()
  }
}
