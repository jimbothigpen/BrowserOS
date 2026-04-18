/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { mergeEnvContent } from '../../../../src/api/services/openclaw/openclaw-env'

describe('mergeEnvContent', () => {
  it('appends new env keys and normalizes trailing newline', () => {
    expect(
      mergeEnvContent('OPENAI_API_KEY=sk-old', {
        ANTHROPIC_API_KEY: 'ant-key',
      }),
    ).toEqual({
      changed: true,
      content: 'OPENAI_API_KEY=sk-old\nANTHROPIC_API_KEY=ant-key\n',
    })
  })

  it('overwrites existing keys when values change', () => {
    expect(
      mergeEnvContent('OPENAI_API_KEY=sk-old\n', {
        OPENAI_API_KEY: 'sk-new',
      }),
    ).toEqual({
      changed: true,
      content: 'OPENAI_API_KEY=sk-new\n',
    })
  })

  it('reports unchanged when incoming values match existing content', () => {
    expect(
      mergeEnvContent('OPENAI_API_KEY=sk-test\n', {
        OPENAI_API_KEY: 'sk-test',
      }),
    ).toEqual({
      changed: false,
      content: 'OPENAI_API_KEY=sk-test\n',
    })
  })
})
