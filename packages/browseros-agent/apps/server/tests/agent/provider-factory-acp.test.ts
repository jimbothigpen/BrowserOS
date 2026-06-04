/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

let lastBuildArgs: Record<string, unknown> | null = null
const fakeLanguageModel = { kind: 'fake-acp-model' }
const fakeProvider = { languageModel: () => fakeLanguageModel }

mock.module('../../src/lib/agents/acpx-provider/buildAcpxProvider', () => ({
  buildAcpxProvider: async (opts: Record<string, unknown>) => {
    lastBuildArgs = opts
    return fakeProvider
  },
}))

const mod = await import('../../src/agent/provider-factory')
const { createLanguageModel } = mod

function baseConfig(): Record<string, unknown> {
  return {
    conversationId: 'conv-acp-1',
    provider: 'claude-code',
    model: 'claude-sonnet-4-6',
  }
}

beforeEach(() => {
  lastBuildArgs = null
})

describe('createLanguageModel — ACP providers', () => {
  it('routes claude-code to buildAcpxProvider with agentId=claude', async () => {
    const model = await createLanguageModel(baseConfig() as never)
    expect(model).toBe(fakeLanguageModel as never)
    expect(lastBuildArgs?.agentId).toBe('claude')
    expect(lastBuildArgs?.conversationId).toBe('conv-acp-1')
  })

  it('routes codex to buildAcpxProvider with agentId=codex', async () => {
    await createLanguageModel({ ...baseConfig(), provider: 'codex' } as never)
    expect(lastBuildArgs?.agentId).toBe('codex')
  })

  it('lets an explicit acpAgentId override the built-in default', async () => {
    await createLanguageModel({
      ...baseConfig(),
      provider: 'claude-code',
      acpAgentId: 'claude-experimental',
    } as never)
    expect(lastBuildArgs?.agentId).toBe('claude-experimental')
  })

  it('requires acpAgentId when provider is acp-custom', async () => {
    await expect(
      createLanguageModel({
        ...baseConfig(),
        provider: 'acp-custom',
      } as never),
    ).rejects.toThrow('acp-custom provider requires acpAgentId')
  })

  it('adds the user-supplied command to agentRegistryOverrides for acp-custom', async () => {
    await createLanguageModel({
      ...baseConfig(),
      provider: 'acp-custom',
      acpAgentId: 'my-agent',
      acpCommand: 'my-bin acp',
    } as never)
    expect(lastBuildArgs?.agentId).toBe('my-agent')
    expect(lastBuildArgs?.agentRegistryOverrides).toEqual({
      'my-agent': 'my-bin acp',
    })
  })

  it('leaves agentRegistryOverrides empty for built-in agents', async () => {
    await createLanguageModel(baseConfig() as never)
    expect(lastBuildArgs?.agentRegistryOverrides).toEqual({})
  })

  it('uses the user-supplied workspace path verbatim', async () => {
    await createLanguageModel({
      ...baseConfig(),
      acpFixedWorkspacePath: '/tmp/some-cwd',
    } as never)
    expect(lastBuildArgs?.workspacePath).toBe('/tmp/some-cwd')
  })

  it('falls back to $HOME/browseros-workspaces/<provider-id> when no path is set', async () => {
    await createLanguageModel(baseConfig() as never)
    expect(lastBuildArgs?.workspacePath).toBe(
      join(homedir(), 'browseros-workspaces', 'claude-code'),
    )
  })
})

describe('createLanguageModel — ACP mcpServers forwarding', () => {
  it('forwards acpMcpServers from ResolvedAgentConfig into buildAcpxProvider', async () => {
    const servers = [
      {
        type: 'http' as const,
        name: 'browseros',
        url: 'http://127.0.0.1:9100/mcp',
        headers: [{ name: 'X-BrowserOS-Scope-Id', value: 'conv-mcp-1' }],
      },
    ]
    await createLanguageModel({
      ...baseConfig(),
      conversationId: 'conv-mcp-1',
      acpMcpServers: servers,
    } as never)
    expect(lastBuildArgs?.mcpServers).toBe(servers as never)
  })

  it('leaves mcpServers undefined when acpMcpServers is not set', async () => {
    await createLanguageModel(baseConfig() as never)
    expect(lastBuildArgs?.mcpServers).toBeUndefined()
  })
})

describe('createLanguageModel — non-ACP providers still work', () => {
  it('routes anthropic through the existing sync factory', async () => {
    const model = await createLanguageModel({
      conversationId: 'conv-2',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
    } as never)
    // The model is whatever createAnthropic({apiKey})('claude-sonnet-4-6') returns.
    // We just need to confirm it's not the ACP fake and that no ACP factory call happened.
    expect(model).not.toBe(fakeLanguageModel as never)
    expect(lastBuildArgs).toBeNull()
  })

  it('throws on an unknown provider type', async () => {
    await expect(
      createLanguageModel({
        conversationId: 'conv-3',
        provider: 'not-a-real-provider',
        model: 'x',
      } as never),
    ).rejects.toThrow('Unknown provider')
  })
})
