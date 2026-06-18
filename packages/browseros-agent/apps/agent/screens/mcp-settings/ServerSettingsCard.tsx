import { Loader2, Network } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { Capabilities, Feature } from '@/lib/browseros/capabilities'
import { BROWSEROS_PREFS } from '@/lib/browseros/prefs'
import { waitForServerHealth } from './server-health'

export interface ServerSettingsCardProps {
  serverUrl: string | null
  onSettingsSaved?: () => void
}

export const ServerSettingsCard: FC<ServerSettingsCardProps> = ({
  serverUrl,
  onSettingsSaved,
}) => {
  const [host, setHost] = useState('0.0.0.0')
  const [port, setPort] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [supportsProxy, setSupportsProxy] = useState(false)
  const baseUrl = serverUrl ? serverUrl.replace(/\/mcp$/, '') : null

  useEffect(() => {
    let active = true
    const init = async () => {
      try {
        const hasProxy = await Capabilities.supports(Feature.PROXY_SUPPORT)
        if (!active) return
        setSupportsProxy(hasProxy)

        let initialPort = ''
        const adapter = getBrowserOSAdapter()
        if (hasProxy) {
          try {
            const pref = await adapter.getPref(BROWSEROS_PREFS.PROXY_PORT)
            if (pref?.value) initialPort = String(pref.value)
          } catch {}
        } else {
          try {
            const pref = await adapter.getPref(BROWSEROS_PREFS.SERVER_PORT)
            if (pref?.value) initialPort = String(pref.value)
          } catch {}
        }

        if (baseUrl) {
          try {
            const res = await fetch(`${baseUrl}/mcp-manager/settings`)
            if (res.ok && active) {
              const data = await res.json()
              const savedHost =
                data.savedSettings?.serverHost || data.activeHost || '0.0.0.0'
              setHost(savedHost)
              if (!initialPort && data.activePort) {
                initialPort = String(data.activePort)
              }
            }
          } catch (err) {
            console.error('Failed to fetch settings from server:', err)
          }
        }

        if (active) {
          setPort(initialPort || '9200')
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to initialize server settings:', err)
        if (active) setLoading(false)
      }
    }
    init()
    return () => {
      active = false
    }
  }, [serverUrl])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return

    const trimmedHost = host.trim()
    const parsedPort = parseInt(port.trim(), 10)

    if (!trimmedHost) {
      toast.error('Host IP Address/Domain cannot be empty')
      return
    }

    if (Number.isNaN(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      toast.error('Port must be a number between 1024 and 65535')
      return
    }

    setSaving(true)
    try {
      // 1. Save settings to settings.json on server
      if (baseUrl) {
        const response = await fetch(`${baseUrl}/mcp-manager/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverHost: trimmedHost,
            serverPort: parsedPort,
          }),
        })
        if (!response.ok) {
          throw new Error('Failed to save settings to server config file')
        }
      }

      // 2. Set Chrome preferences
      const adapter = getBrowserOSAdapter()
      if (supportsProxy) {
        await adapter.setPref(BROWSEROS_PREFS.PROXY_PORT, parsedPort)
      } else {
        await adapter.setPref(BROWSEROS_PREFS.SERVER_PORT, parsedPort)
        await adapter.setPref(BROWSEROS_PREFS.MCP_PORT, parsedPort)
      }

      // 3. Request server restart
      await adapter.setPref(BROWSEROS_PREFS.RESTART_SERVER, true)

      // 4. Poll health check
      const healthy = await waitForServerHealth()
      if (healthy) {
        toast.success('Server settings updated and restarted successfully')
        onSettingsSaved?.()
      } else {
        toast.warning(
          'Settings saved, but server did not respond. Try restarting the browser.',
        )
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update settings',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="border border-border bg-card shadow-sm">
        <CardContent className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-border bg-card shadow-sm transition-all hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="font-semibold text-lg">
            Connection Settings
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Configure the host IP address and port that BrowserOS uses.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="server-host">Host IP / Address</Label>
              <Input
                id="server-host"
                placeholder="0.0.0.0"
                value={host}
                disabled={saving}
                onChange={(e) => setHost(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Set to <code>127.0.0.1</code> for local-only, or{' '}
                <code>0.0.0.0</code> to allow other machines to connect.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-port-input">Port</Label>
              <Input
                id="server-port-input"
                type="number"
                placeholder="9200"
                value={port}
                disabled={saving}
                onChange={(e) => setPort(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                The port external MCP clients connect to. Saving will restart
                the server.
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving || !host || !port}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Restarting…
                </>
              ) : (
                'Save & Restart'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
