import { describe, expect, test } from 'bun:test'
import { ARCHES, assertCalver, parseArch } from '../src/schema/arch'

describe('parseArch', () => {
  test('accepts supported arches', () => {
    expect(parseArch('arm64')).toBe('arm64')
    expect(parseArch('x64')).toBe('x64')
  })

  test('rejects unsupported arches', () => {
    expect(() => parseArch('amd64')).toThrow(/invalid arch/)
    expect(() => parseArch('')).toThrow(/invalid arch/)
  })

  test('ARCHES contains exactly the supported set', () => {
    expect([...ARCHES].sort()).toEqual(['arm64', 'x64'])
  })
})

describe('assertCalver', () => {
  test('accepts YYYY.MM.DD and YYYY.MM.DD-N', () => {
    assertCalver('2026.04.22')
    assertCalver('2026.04.22-1')
    assertCalver('2026.12.01-99')
  })

  test('rejects semver and stray strings', () => {
    expect(() => assertCalver('1.2.3')).toThrow(/invalid CalVer/)
    expect(() => assertCalver('2026-04-22')).toThrow(/invalid CalVer/)
    expect(() => assertCalver('latest')).toThrow(/invalid CalVer/)
  })
})
