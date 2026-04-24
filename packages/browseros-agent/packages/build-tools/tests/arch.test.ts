import { describe, expect, it } from 'bun:test'
import { parseArch, podmanArch } from '../scripts/common/arch'

describe('arch helpers', () => {
  it('normalizes BrowserOS arches for podman', () => {
    expect(podmanArch('arm64')).toBe('arm64')
    expect(podmanArch('x64')).toBe('amd64')
  })

  it('parses supported release arches', () => {
    expect(parseArch('arm64')).toBe('arm64')
    expect(parseArch('x64')).toBe('x64')
  })

  it('rejects unsupported release arches', () => {
    expect(() => parseArch('amd64')).toThrow('unknown arch: amd64')
  })
})
