import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildTarball, registryForImage } from '../src/build'

const tempDirs: string[] = []

function processResult(
  stdout: string,
  stderr = '',
  exitCode = 0,
): Bun.Subprocess {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(exitCode),
  } as Bun.Subprocess
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-container-build-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  mock.restore()
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('build', () => {
  it('resolves registry hosts correctly', () => {
    expect(registryForImage('ghcr.io/openclaw/openclaw')).toBe('ghcr.io')
    expect(registryForImage('localhost:5000/example/image')).toBe(
      'localhost:5000',
    )
    expect(registryForImage('busybox')).toBe('docker.io')
  })

  it('builds a tarball result and writes the sidecar files', async () => {
    const dir = await createTempDir()
    const outputDir = join(dir, 'dist')
    const recipePath = join(dir, 'agents.json')
    await writeFile(
      recipePath,
      JSON.stringify({
        schema: 'v1',
        agents: [
          {
            name: 'openclaw',
            image: 'ghcr.io/openclaw/openclaw',
            version: '2026.4.12',
            arches: ['arm64'],
          },
        ],
      }),
      'utf8',
    )

    const originalSpawn = Bun.spawn
    const podmanCommands: string[][] = []
    spyOn(Bun, 'spawn').mockImplementation((command, options) => {
      if (Array.isArray(command) && command[0] === 'podman') {
        podmanCommands.push(command)

        if (command[1] === '--version') {
          return processResult('podman version 5.8.1\n')
        }
        if (command[1] === 'pull') {
          return processResult('')
        }
        if (command[1] === 'inspect') {
          return processResult(
            JSON.stringify({
              Id: 'f'.repeat(64),
              Digest: `sha256:${'1'.repeat(64)}`,
              RepoDigests: [
                `ghcr.io/openclaw/openclaw@sha256:${'2'.repeat(64)}`,
                `ghcr.io/openclaw/openclaw@sha256:${'1'.repeat(64)}`,
              ],
              Architecture: 'arm64',
              Os: 'linux',
              Config: {
                Entrypoint: ['/entrypoint.sh'],
                Env: ['NODE_ENV=production'],
              },
              RootFS: {
                Type: 'layers',
                Layers: ['sha256:abc'],
              },
            }),
          )
        }
        if (command[1] === 'save') {
          const outPath = String(command[5])
          void writeFile(outPath, 'oci archive payload', 'utf8')
          return processResult('')
        }
      }

      return originalSpawn(
        command as string[],
        options as SpawnOptions.OptionsObject<string[]>,
      )
    })

    const result = await buildTarball({
      agent: {
        name: 'openclaw',
        image: 'ghcr.io/openclaw/openclaw',
        version: '2026.4.12',
        arches: ['arm64'],
      },
      arch: 'arm64',
      outputDir,
      recipePath,
      builtBy: 'test-run',
    })

    expect(result.filename).toBe('openclaw-2026.4.12-arm64.tar.gz')
    expect(result.sourceOciDigest).toBe(`sha256:${'2'.repeat(64)}`)
    expect(result.imageId).toBe(`sha256:${'f'.repeat(64)}`)
    expect(result.smokeFingerprint).toHaveLength(64)
    expect(existsSync(result.tarballPath)).toBe(true)
    expect(existsSync(result.tarballShaPath)).toBe(true)
    expect(existsSync(join(outputDir, 'openclaw-2026.4.12-arm64.tar'))).toBe(
      false,
    )
    expect(existsSync(join(outputDir, 'build-result.json'))).toBe(true)
    expect(
      podmanCommands.some(
        (command) =>
          command[1] === 'pull' &&
          command.includes('--arch') &&
          command.includes('arm64'),
      ),
    ).toBe(true)
  })
})
