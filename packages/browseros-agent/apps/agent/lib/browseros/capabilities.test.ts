import { describe, expect, it } from 'bun:test'
import { resolveStaticFeatureSupport } from './capabilities'

describe('resolveStaticFeatureSupport', () => {
  it('keeps alpha-gated features off by default in development', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: true,
        alphaFeaturesEnabled: false,
        requiresAlphaFlag: true,
      }),
    ).toBe(false)
  })

  it('enables alpha-gated features only when explicitly opted in', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: false,
        alphaFeaturesEnabled: true,
        requiresAlphaFlag: true,
      }),
    ).toBe(true)
  })

  it('keeps non-alpha features enabled in development', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: true,
        alphaFeaturesEnabled: false,
      }),
    ).toBe(true)
  })

  it('leaves non-alpha features unresolved in production', () => {
    expect(
      resolveStaticFeatureSupport({
        isDevelopment: false,
        alphaFeaturesEnabled: false,
      }),
    ).toBeNull()
  })
})
