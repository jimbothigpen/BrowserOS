import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'dotenv'

import type { R2Config } from '../server/types'

const PROD_ENV_PATH = join('apps', 'cli', '.env.production')
const PROD_ENV_TEMPLATE_PATH = join('apps', 'cli', '.env.production.example')

function pickEnv(name: string, fileEnv: Record<string, string>): string {
  const value = process.env[name] ?? fileEnv[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function loadProdEnv(rootDir: string): Record<string, string> {
  const prodEnvPath = join(rootDir, PROD_ENV_PATH)
  if (!existsSync(prodEnvPath)) {
    const templatePath = join(rootDir, PROD_ENV_TEMPLATE_PATH)
    if (existsSync(templatePath)) {
      throw new Error(
        `Missing ${PROD_ENV_PATH}. Create it from ${PROD_ENV_TEMPLATE_PATH} before running upload:cli-installers.`,
      )
    }
    throw new Error(
      `Missing ${PROD_ENV_PATH}. The template file ${PROD_ENV_TEMPLATE_PATH} was not found.`,
    )
  }
  return parse(readFileSync(prodEnvPath, 'utf-8'))
}

export interface CliUploadConfig {
  r2: R2Config
}

export function loadCliUploadConfig(rootDir: string): CliUploadConfig {
  const fileEnv = loadProdEnv(rootDir)
  return {
    r2: {
      accountId: pickEnv('R2_ACCOUNT_ID', fileEnv),
      accessKeyId: pickEnv('R2_ACCESS_KEY_ID', fileEnv),
      secretAccessKey: pickEnv('R2_SECRET_ACCESS_KEY', fileEnv),
      bucket: pickEnv('R2_BUCKET', fileEnv),
      downloadPrefix: '',
      uploadPrefix:
        process.env.R2_UPLOAD_PREFIX ?? fileEnv.R2_UPLOAD_PREFIX ?? 'cli',
    },
  }
}
