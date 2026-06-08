import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { get_bookmarks } from '../../src/tools/browser/bookmarks'
import { get_dom } from '../../src/tools/browser/dom'
import { search_history } from '../../src/tools/browser/history'
import { click } from '../../src/tools/browser/input'
import { list_pages } from '../../src/tools/browser/navigation'
import { save_pdf } from '../../src/tools/browser/page-actions'
import { take_snapshot } from '../../src/tools/browser/snapshot'
import { group_tabs } from '../../src/tools/browser/tab-groups'
import { list_windows } from '../../src/tools/browser/windows'
import { registry } from '../../src/tools/registry'

const browserToolFiles = [
  'bookmarks.ts',
  'dom.ts',
  'history.ts',
  'input.ts',
  'navigation.ts',
  'page-actions.ts',
  'snapshot.ts',
  'tab-groups.ts',
  'windows.ts',
]

describe('browser tool boundary', () => {
  it('keeps browser tool modules under src/tools/browser', () => {
    const toolsDir = join(import.meta.dir, '../../src/tools')

    for (const file of browserToolFiles) {
      assert.ok(
        existsSync(join(toolsDir, 'browser', file)),
        `Expected browser/${file}`,
      )
      assert.ok(!existsSync(join(toolsDir, file)), `Unexpected ${file}`)
    }

    assert.ok(
      !existsSync(join(toolsDir, 'browser', 'console.ts')),
      'Unexpected browser/console.ts',
    )
  })

  it('registers browser tools from the browser tool modules', () => {
    assert.strictEqual(registry.get('get_bookmarks'), get_bookmarks)
    assert.strictEqual(registry.get('get_console_logs'), undefined)
    assert.strictEqual(registry.get('get_dom'), get_dom)
    assert.strictEqual(registry.get('search_history'), search_history)
    assert.strictEqual(registry.get('click'), click)
    assert.strictEqual(registry.get('list_pages'), list_pages)
    assert.strictEqual(registry.get('save_pdf'), save_pdf)
    assert.strictEqual(registry.get('take_snapshot'), take_snapshot)
    assert.strictEqual(registry.get('group_tabs'), group_tabs)
    assert.strictEqual(registry.get('list_windows'), list_windows)
  })
})
