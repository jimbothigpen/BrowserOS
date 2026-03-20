import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { track } from '@/lib/metrics/track'
import { getProviderTemplate } from './providerTemplates'
import type { LlmProviderConfig, ProviderType } from './types'
import { useOAuthStatus } from './useOAuthStatus'

interface OAuthProviderFlowConfig {
  providerType: ProviderType
  displayName: string
  startedEvent: string
  completedEvent: string
  disconnectedEvent: string
}

interface OAuthProviderFlowReturn {
  status: { authenticated: boolean; email?: string } | null
  disconnect: () => Promise<void>
  startOAuthFlow: (agentServerUrl: string | undefined) => Promise<void>
}

export function useOAuthProviderFlow(
  config: OAuthProviderFlowConfig,
  providers: LlmProviderConfig[],
  saveProvider: (provider: LlmProviderConfig) => Promise<void> | void,
): OAuthProviderFlowReturn {
  const { status, startPolling, disconnect } = useOAuthStatus(
    config.providerType,
  )
  const flowStartedRef = useRef(false)
  const flowStartedAtRef = useRef(0)

  // Auto-create provider when OAuth completes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — only trigger on auth status change
  useEffect(() => {
    if (!status?.authenticated) return
    if (!flowStartedRef.current) return
    if (providers.some((p) => p.type === config.providerType)) return

    const now = Date.now()
    try {
      const template = getProviderTemplate(config.providerType)
      saveProvider({
        id: `${config.providerType}-${now}`,
        type: config.providerType,
        name: `${config.displayName}${status.email ? ` (${status.email})` : ''}`,
        modelId: template?.defaultModelId ?? '',
        supportsImages: template?.supportsImages ?? true,
        contextWindow: template?.contextWindow ?? 128000,
        temperature: 0.2,
        createdAt: now,
        updatedAt: now,
      })
      track(config.completedEvent, { email: status.email })
      toast.success(`${config.displayName} Connected`, {
        description: status.email
          ? `Authenticated as ${status.email}`
          : `Successfully authenticated with ${config.displayName}`,
      })
    } catch (err) {
      toast.error(`Failed to create ${config.displayName} provider`, {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      flowStartedRef.current = false
      flowStartedAtRef.current = 0
    }
  }, [status?.authenticated])

  async function startOAuthFlow(agentServerUrl: string | undefined) {
    if (!agentServerUrl) {
      toast.error('Server not available', {
        description: 'Cannot start OAuth flow without server connection.',
      })
      return
    }

    // Prevent rapid duplicate requests (30s cooldown)
    const timeSinceLastStart = Date.now() - flowStartedAtRef.current
    if (timeSinceLastStart < 30_000) {
      toast.info('Authentication already in progress', {
        description: `Please complete the ${config.displayName} login in the opened tab.`,
      })
      return
    }

    flowStartedRef.current = true
    flowStartedAtRef.current = Date.now()

    try {
      const res = await fetch(
        `${agentServerUrl}/oauth/${config.providerType}/start`,
      )

      // Device code flow returns JSON
      if (res.headers.get('content-type')?.includes('application/json')) {
        const data = (await res.json()) as {
          userCode?: string
          verificationUri?: string
          error?: string
        }

        // Server returned an error (e.g. WAF block)
        if (!res.ok || data.error) {
          throw new Error(data.error || `Server returned ${res.status}`)
        }

        if (!data.userCode || !data.verificationUri) {
          throw new Error('Invalid response from server')
        }
        window.open(data.verificationUri, '_blank')
        startPolling()
        track(config.startedEvent)
        toast.info(`Enter code: ${data.userCode}`, {
          description: `Paste this code on the ${config.displayName} page that just opened.`,
          duration: 60_000,
        })
        return
      }

      // PKCE redirect flow
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      window.open(res.url, '_blank')
      startPolling()
      track(config.startedEvent)
      toast.info(`Authenticating with ${config.displayName}`, {
        description: 'Complete the login in the opened tab.',
      })
    } catch (err) {
      flowStartedRef.current = false
      flowStartedAtRef.current = 0
      toast.error(`Failed to start ${config.displayName} authentication`, {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return {
    status,
    disconnect,
    startOAuthFlow,
  }
}
