import { S3Client } from '@aws-sdk/client-s3'

export function createR2Client(): S3Client {
  const accountId = requireEnv('R2_ACCOUNT_ID')
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  })
}

export function getBucket(): string {
  return requireEnv('R2_BUCKET')
}

export function getCdnBaseUrl(): string {
  return process.env.CDN_BASE_URL ?? 'https://cdn.browseros.com'
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var: ${name}`)
  return value
}
