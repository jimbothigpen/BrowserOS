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
  /** Provider requires client-side device code request (e.g. Qwen WAF) */
  clientSideDeviceCode?: {
    deviceCodeEndpoint: string
    clientId: string
    scopes: string
    requiresPKCE: boolean
  }
}

interface OAuthProviderFlowReturn {
  status: { authenticated: boolean; email?: string } | null
  disconnect: () => Promise<void>
  startOAuthFlow: (agentServerUrl: string | undefined) => Promise<void>
  isDeviceCode: boolean
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
    }
  }, [status?.authenticated])

  async function startOAuthFlow(agentServerUrl: string | undefined) {
    if (!agentServerUrl) {
      toast.error('Server not available', {
        description: 'Cannot start OAuth flow without server connection.',
      })
      return
    }
    flowStartedRef.current = true
    try {
      // Client-side device code flow (e.g. Qwen — needs browser cookies to bypass WAF)
      if (config.clientSideDeviceCode) {
        await startClientSideDeviceCode(agentServerUrl)
        return
      }

      const res = await fetch(
        `${agentServerUrl}/oauth/${config.providerType}/start`,
      )

      // Device code flow returns JSON
      if (res.headers.get('content-type')?.includes('application/json')) {
        const data = (await res.json()) as {
          userCode?: string
          verificationUri?: string
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

      // PKCE flow — server redirected, just poll
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      window.open(res.url, '_blank')
      startPolling()
      track(config.startedEvent)
      toast.info(`Authenticating with ${config.displayName}`, {
        description: 'Complete the login in the opened tab.',
      })
    } catch (err) {
      flowStartedRef.current = false
      toast.error(`Failed to start ${config.displayName} authentication`, {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  async function startClientSideDeviceCode(agentServerUrl: string) {
    const cfg = config.clientSideDeviceCode
    if (!cfg) return

    // Generate PKCE verifier/challenge if required
    let codeVerifier: string | undefined
    const params: Record<string, string> = {
      client_id: cfg.clientId,
      scope: cfg.scopes,
    }
    if (cfg.requiresPKCE) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      codeVerifier = base64UrlEncode(bytes)
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(codeVerifier),
      )
      params.code_challenge = base64UrlEncode(new Uint8Array(digest))
      params.code_challenge_method = 'S256'
    }

    // Request device code from provider (client-side to include browser cookies)
    const res = await fetch(cfg.deviceCodeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
      credentials: 'include',
    })

    if (!res.ok) throw new Error(`Device code request failed: ${res.status}`)
    const data = (await res.json()) as {
      device_code?: string
      user_code?: string
      verification_uri?: string
      verification_uri_complete?: string
      expires_in?: number
      interval?: number
    }
    if (!data.device_code || !data.user_code) {
      throw new Error('Invalid device code response')
    }

    // Hand off to server for background polling
    const pollRes = await fetch(
      `${agentServerUrl}/oauth/${config.providerType}/poll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceCode: data.device_code,
          interval: data.interval ?? 5,
          expiresIn: data.expires_in ?? 900,
          codeVerifier,
        }),
      },
    )
    if (!pollRes.ok) throw new Error(`Server returned ${pollRes.status}`)

    // Open verification page and start polling for completion
    const verificationUri =
      data.verification_uri_complete ?? data.verification_uri
    window.open(verificationUri, '_blank')
    startPolling()
    track(config.startedEvent)
    toast.info(`Enter code: ${data.user_code}`, {
      description: `Paste this code on the ${config.displayName} page that just opened.`,
      duration: 60_000,
    })
  }

  return {
    status,
    disconnect,
    startOAuthFlow,
    isDeviceCode: true,
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
