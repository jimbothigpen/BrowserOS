/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../../src/lib/db'
import { agentDefinitions } from '../../../src/lib/db/schema'

describe('database initialization', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  it('creates the parent directory, opens sqlite, and runs migrations', () => {
    const dir = mkTempDir()
    const dbPath = join(dir, 'nested', 'browseros.sqlite')

    const handle = initializeDb({ dbPath })
    const rows = handle.db.select().from(agentDefinitions).all()

    expect(existsSync(dbPath)).toBe(true)
    expect(rows).toEqual([])
  })

  it('is idempotent when initialized twice for the same path', () => {
    const dir = mkTempDir()
    const dbPath = join(dir, 'browseros.sqlite')

    const first = initializeDb({ dbPath })
    const second = initializeDb({ dbPath })

    expect(second).toBe(first)
  })

  it('bootstraps the current schema when migration files are unavailable', () => {
    const dir = mkTempDir()
    const handle = initializeDb({
      dbPath: join(dir, 'browseros.sqlite'),
      migrationsDir: join(dir, 'missing-migrations'),
    })

    const tables = handle.sqlite
      .query<{ name: string }, []>(
        `
          SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'agent_definitions',
              'oauth_tokens',
              'produced_files',
              '__drizzle_migrations'
            )
          ORDER BY name
        `,
      )
      .all()
      .map((row) => row.name)

    expect(tables).toEqual([
      '__drizzle_migrations',
      'agent_definitions',
      'oauth_tokens',
      'produced_files',
    ])
    expect(
      handle.sqlite
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM __drizzle_migrations',
        )
        .get()?.count,
    ).toBe(3)
    expect(handle.db.select().from(agentDefinitions).all()).toEqual([])
  })

  it('does not rerun old migrations after fallback schema bootstrap', () => {
    const dir = mkTempDir()
    const dbPath = join(dir, 'browseros.sqlite')

    initializeDb({
      dbPath,
      migrationsDir: join(dir, 'missing-migrations'),
    })
    closeDb()

    expect(() => initializeDb({ dbPath })).not.toThrow()
  })

  function mkTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-db-test-'))
    tempDirs.push(dir)
    return dir
  }
})
