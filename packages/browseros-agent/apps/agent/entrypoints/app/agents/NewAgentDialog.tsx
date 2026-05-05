import { AlertCircle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  HarnessAdapterDescriptor,
  HarnessAgentAdapter,
} from './agent-harness-types'
import type { CreateAgentRuntime, ProviderOption } from './agents-page-types'
import { getHermesCliInstallPrompt } from './hermes-install-prompt'
import { ProviderSelector } from './OpenClawControls'
import {
  type OpenClawCliProvider,
  type OpenClawCliProviderAuthStatus,
  OpenClawCliProviderStatusPanel,
} from './openclaw-cli-providers'

interface NewAgentDialogProps {
  adapters: HarnessAdapterDescriptor[]
  canManageOpenClaw: boolean
  createError: string | null
  createRuntime: CreateAgentRuntime
  creating: boolean
  defaultProviderId: string
  harnessAdapterId: HarnessAgentAdapter
  harnessModelId: string
  harnessReasoningEffort: string
  name: string
  open: boolean
  providers: ProviderOption[]
  selectedCliProvider: OpenClawCliProvider | undefined
  selectedProviderId: string
  cliAuthError: Error | null
  cliAuthLoading: boolean
  cliAuthStatus: OpenClawCliProviderAuthStatus | undefined
  onConnectCliProvider: () => void
  onCreate: () => void
  onOpenChange: (open: boolean) => void
  onRuntimeChange: (runtime: CreateAgentRuntime) => void
  onHarnessAdapterChange: (adapter: HarnessAgentAdapter) => void
  onHarnessModelChange: (modelId: string) => void
  onHarnessReasoningChange: (reasoningEffort: string) => void
  onNameChange: (name: string) => void
  onProviderChange: (providerId: string) => void
}

export const NewAgentDialog: FC<NewAgentDialogProps> = ({
  adapters,
  canManageOpenClaw,
  createError,
  createRuntime,
  creating,
  defaultProviderId,
  harnessAdapterId,
  harnessModelId,
  harnessReasoningEffort,
  name,
  open,
  providers,
  selectedCliProvider,
  selectedProviderId,
  cliAuthError,
  cliAuthLoading,
  cliAuthStatus,
  onConnectCliProvider,
  onCreate,
  onOpenChange,
  onRuntimeChange,
  onHarnessAdapterChange,
  onHarnessModelChange,
  onHarnessReasoningChange,
  onNameChange,
  onProviderChange,
}) => {
  const selectedHarnessAdapter =
    adapters.find((adapter) => adapter.id === harnessAdapterId) ?? adapters[0]
  const selectedCreateAdapter =
    createRuntime === 'openclaw'
      ? selectedHarnessAdapter
      : (adapters.find((adapter) => adapter.id === createRuntime) ??
        selectedHarnessAdapter)
  const hermesInstallPrompt = getHermesCliInstallPrompt({
    createRuntime,
    selectedAdapter: selectedCreateAdapter,
  })
  const harnessModels = selectedHarnessAdapter?.models ?? []
  const harnessReasoningEfforts = selectedHarnessAdapter?.reasoningEfforts ?? []
  const isHarnessRuntime = createRuntime !== 'openclaw'
  const openClawBlocked = createRuntime === 'openclaw' && !canManageOpenClaw
  const cliBlocked =
    createRuntime === 'openclaw' &&
    !!selectedCliProvider &&
    !cliAuthStatus?.loggedIn
  const canCreate =
    Boolean(name.trim()) &&
    !creating &&
    !openClawBlocked &&
    !cliBlocked &&
    !hermesInstallPrompt &&
    (createRuntime === 'openclaw'
      ? providers.length > 0
      : Boolean(selectedHarnessAdapter))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {createError ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Create failed</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={
                createRuntime === 'openclaw' ? 'research-agent' : 'Review bot'
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreate) onCreate()
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agent-runtime">Adapter</Label>
            <Select
              value={createRuntime}
              onValueChange={(value) => {
                if (
                  value === 'openclaw' ||
                  value === 'claude' ||
                  value === 'codex' ||
                  value === 'hermes'
                ) {
                  onRuntimeChange(value)
                  if (value !== 'openclaw') onHarnessAdapterChange(value)
                }
              }}
            >
              <SelectTrigger id="agent-runtime">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {adapters.map((adapter) => (
                  <SelectItem key={adapter.id} value={adapter.id}>
                    {adapter.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {createRuntime === 'openclaw' ? (
            <>
              {openClawBlocked ? (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>OpenClaw is not ready</AlertTitle>
                  <AlertDescription>
                    Start or set up the OpenClaw gateway before creating an
                    OpenClaw agent.
                  </AlertDescription>
                </Alert>
              ) : null}

              <ProviderSelector
                providers={providers}
                defaultProviderId={defaultProviderId}
                selectedId={selectedProviderId}
                onSelect={onProviderChange}
                hideApiKeyHint={!!selectedCliProvider}
              />

              {selectedCliProvider ? (
                <OpenClawCliProviderStatusPanel
                  provider={selectedCliProvider}
                  status={cliAuthStatus}
                  loading={cliAuthLoading}
                  fetchError={cliAuthError}
                  onConnect={onConnectCliProvider}
                />
              ) : null}
            </>
          ) : null}

          {isHarnessRuntime ? (
            <>
              {hermesInstallPrompt ? (
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertTitle>{hermesInstallPrompt.title}</AlertTitle>
                  <AlertDescription>
                    <div className="grid gap-2">
                      <p>{hermesInstallPrompt.description}</p>
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {hermesInstallPrompt.installCommand}
                      </code>
                      <a
                        href={hermesInstallPrompt.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary text-xs underline underline-offset-4"
                      >
                        Hermes ACP setup
                      </a>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              {harnessModels.length > 0 ? (
                <div className="grid gap-2">
                  <Label htmlFor="harness-model">Model</Label>
                  <Select
                    value={harnessModelId}
                    onValueChange={onHarnessModelChange}
                  >
                    <SelectTrigger id="harness-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {harnessModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="harness-effort">Reasoning</Label>
                <Select
                  value={harnessReasoningEffort}
                  onValueChange={onHarnessReasoningChange}
                >
                  <SelectTrigger id="harness-effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {harnessReasoningEfforts.map((effort) => (
                      <SelectItem key={effort.id} value={effort.id}>
                        {effort.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={onCreate}>
            {creating ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
