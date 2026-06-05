import { describe, expect, test } from 'bun:test'
import { diffSnapshots } from './diff'

describe('diffSnapshots', () => {
  test('identical snapshots short-circuit to no change', () => {
    const snap = '- button "Go" [ref=e1]'
    expect(diffSnapshots(snap, snap)).toEqual({
      text: '',
      added: 0,
      removed: 0,
      changed: false,
    })
  })

  test('a state change shows a removed/added pair on the same ref', () => {
    const before = '- button "Save" [ref=e1]'
    const after = '- button "Save" [ref=e1] [disabled]'
    const d = diffSnapshots(before, after)

    expect(d.changed).toBe(true)
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.text).toContain('- button "Save" [ref=e1]')
    expect(d.text).toContain('+ button "Save" [ref=e1] [disabled]')
    expect(d.text).toContain('1 added, 1 removed')
  })

  test('pure additions count only as added and strip the list bullet', () => {
    const before = '- main\n  - link "Home" [ref=e1]'
    const after = '- main\n  - link "Home" [ref=e1]\n  - link "About" [ref=e2]'
    const d = diffSnapshots(before, after)

    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
    expect(d.text).toContain('+   link "About" [ref=e2]')
  })

  test('collapses far-apart context with an ellipsis', () => {
    const before = Array.from({ length: 30 }, (_, i) => `- item ${i}`).join(
      '\n',
    )
    const after = before
      .replace('- item 0', '- item ZERO')
      .replace('- item 29', '- item LAST')
    const d = diffSnapshots(before, after, { contextRadius: 2 })

    expect(d.text).toContain('…')
    expect(d.text).toContain('- item 0')
    expect(d.text).toContain('+ item ZERO')
    expect(d.text).toContain('+ item LAST')
    // The unchanged middle (e.g. item 15) is elided.
    expect(d.text).not.toContain('item 15')
  })
})
