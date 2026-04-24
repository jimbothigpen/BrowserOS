import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export async function verifySha256(
  path: string,
  expected: string,
): Promise<void> {
  const actual = await sha256File(path)
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${path}: expected ${expected}, got ${actual}`,
    )
  }
}
