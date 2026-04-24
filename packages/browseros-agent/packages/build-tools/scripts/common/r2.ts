import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing env var: ${name}`)
  return value
}

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  })
}

export function getBucket(): string {
  return required('R2_BUCKET')
}

export function getCdnBase(): string {
  return process.env.R2_PUBLIC_BASE_URL?.trim() ?? 'https://cdn.browseros.com'
}

export async function putFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const { size } = await stat(filePath)
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    }),
  )
}

export async function putBody(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: Buffer.byteLength(body),
      ContentType: contentType,
    }),
  )
}

export async function getBody(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    )
    const body = response.Body as
      | { transformToByteArray(): Promise<Uint8Array> }
      | undefined
    if (!body) throw new Error(`missing response body for R2 key: ${key}`)
    const bytes = await body.transformToByteArray()
    return new TextDecoder().decode(bytes)
  } catch (error) {
    const cause = error as {
      name?: string
      $metadata?: { httpStatusCode?: number }
    }
    if (cause.name === 'NoSuchKey' || cause.$metadata?.httpStatusCode === 404) {
      return null
    }
    throw error
  }
}
