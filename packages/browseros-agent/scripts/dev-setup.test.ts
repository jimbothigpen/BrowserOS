import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildEnvCopyPlans, parsePrimaryWorktreeRoot } from './dev-setup'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browseros-dev-setup-'))
  tempDirs.push(dir)
  return dir
}

function writeFile(root: string, relativePath: string, contents = ''): string {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents)
  return filePath
}

describe('parsePrimaryWorktreeRoot', () => {
  test('returns the first worktree from porcelain output', () => {
    const output = [
      'worktree /repo/main',
      'HEAD abc',
      'branch refs/heads/dev',
      '',
      'worktree /repo/.grove/worktrees/fix/setup',
      'HEAD def',
      'branch refs/heads/fix/setup',
    ].join('\n')

    expect(parsePrimaryWorktreeRoot(output)).toBe('/repo/main')
  })

  test('returns null when no worktree entries exist', () => {
    expect(
      parsePrimaryWorktreeRoot('HEAD abc\nbranch refs/heads/dev'),
    ).toBeNull()
  })
})

describe('buildEnvCopyPlans', () => {
  test('prefers primary worktree env files before examples', () => {
    const repoRoot = createTempDir()
    const primaryRoot = createTempDir()

    writeFile(repoRoot, 'apps/agent/.env.example', 'example-agent')
    writeFile(repoRoot, 'apps/server/.env.example', 'example-server-dev')
    writeFile(
      repoRoot,
      'apps/server/.env.production.example',
      'example-server-prod',
    )
    const primaryAgentEnv = writeFile(
      primaryRoot,
      'apps/agent/.env.development',
      'primary-agent',
    )
    const primaryServerDevEnv = writeFile(
      primaryRoot,
      'apps/server/.env.development',
      'primary-server-dev',
    )
    const primaryServerProdEnv = writeFile(
      primaryRoot,
      'apps/server/.env.production',
      'primary-server-prod',
    )

    const plans = buildEnvCopyPlans(repoRoot, primaryRoot)

    expect(plans).toEqual([
      {
        reason: 'main-worktree',
        source: primaryAgentEnv,
        target: join(repoRoot, 'apps/agent/.env.development'),
      },
      {
        reason: 'main-worktree',
        source: primaryServerDevEnv,
        target: join(repoRoot, 'apps/server/.env.development'),
      },
      {
        reason: 'main-worktree',
        source: primaryServerProdEnv,
        target: join(repoRoot, 'apps/server/.env.production'),
      },
    ])
  })

  test('falls back to example files when the primary worktree is missing env files', () => {
    const repoRoot = createTempDir()
    const primaryRoot = createTempDir()

    const agentExample = writeFile(
      repoRoot,
      'apps/agent/.env.example',
      'example-agent',
    )
    const serverExample = writeFile(
      repoRoot,
      'apps/server/.env.example',
      'example-server-dev',
    )
    const serverProdExample = writeFile(
      repoRoot,
      'apps/server/.env.production.example',
      'example-server-prod',
    )

    const plans = buildEnvCopyPlans(repoRoot, primaryRoot)

    expect(plans).toEqual([
      {
        reason: 'example',
        source: agentExample,
        target: join(repoRoot, 'apps/agent/.env.development'),
      },
      {
        reason: 'example',
        source: serverExample,
        target: join(repoRoot, 'apps/server/.env.development'),
      },
      {
        reason: 'example',
        source: serverProdExample,
        target: join(repoRoot, 'apps/server/.env.production'),
      },
    ])
  })

  test('skips files that already exist in the current worktree', () => {
    const repoRoot = createTempDir()
    const primaryRoot = createTempDir()

    writeFile(repoRoot, 'apps/agent/.env.development', 'current-agent')
    writeFile(repoRoot, 'apps/agent/.env.example', 'example-agent')
    writeFile(repoRoot, 'apps/server/.env.example', 'example-server-dev')
    writeFile(
      repoRoot,
      'apps/server/.env.production.example',
      'example-server-prod',
    )
    const primaryServerDevEnv = writeFile(
      primaryRoot,
      'apps/server/.env.development',
      'primary-server-dev',
    )
    const primaryServerProdEnv = writeFile(
      primaryRoot,
      'apps/server/.env.production',
      'primary-server-prod',
    )

    const plans = buildEnvCopyPlans(repoRoot, primaryRoot)

    expect(plans).toEqual([
      {
        reason: 'main-worktree',
        source: primaryServerDevEnv,
        target: join(repoRoot, 'apps/server/.env.development'),
      },
      {
        reason: 'main-worktree',
        source: primaryServerProdEnv,
        target: join(repoRoot, 'apps/server/.env.production'),
      },
    ])
  })
})
