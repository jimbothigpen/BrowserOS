import {
  ArrowRight,
  Bot,
  ChevronDown,
  Folder,
  Layers,
  Loader2,
  Mic,
  Square,
} from 'lucide-react'
import {
  type FC,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AppSelector } from '@/components/elements/AppSelector'
import { TabPickerPopover } from '@/components/elements/tab-picker-popover'
import { WorkspaceSelector } from '@/components/elements/workspace-selector'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentEntry } from '@/entrypoints/app/agents/useOpenClaw'
import { McpServerIcon } from '@/entrypoints/app/connect-mcp/McpServerIcon'
import { useGetUserMCPIntegrations } from '@/entrypoints/app/connect-mcp/useGetUserMCPIntegrations'
import { Feature } from '@/lib/browseros/capabilities'
import { useCapabilities } from '@/lib/browseros/useCapabilities'
import { useMcpServers } from '@/lib/mcp/mcpServerStorage'
import { cn } from '@/lib/utils'
import { useVoiceInput } from '@/lib/voice/useVoiceInput'
import { useWorkspace } from '@/lib/workspace/use-workspace'
import { AgentSelector } from './AgentSelector'

interface ConversationInputProps {
  agents: AgentEntry[]
  selectedAgentId: string | null
  onSelectAgent: (agent: AgentEntry) => void
  onSend: (text: string) => void
  onCreateAgent?: () => void
  streaming: boolean
  disabled?: boolean
  status?: string
  placeholder?: string
  variant?: 'home' | 'conversation'
}

function InputActionButton({
  disabled,
  onClick,
  streaming,
}: {
  disabled: boolean
  onClick: () => void
  streaming: boolean
}) {
  return (
    <Button
      onClick={onClick}
      size="icon"
      disabled={disabled}
      className="h-10 w-10 flex-shrink-0 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
    >
      {streaming ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <ArrowRight className="h-5 w-5" />
      )}
    </Button>
  )
}

function VoiceButton({
  isRecording,
  isTranscribing,
  onStart,
  onStop,
}: {
  isRecording: boolean
  isTranscribing: boolean
  onStart: () => void
  onStop: () => void
}) {
  if (isRecording) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onStop}
        className="h-10 w-10 flex-shrink-0 rounded-xl bg-red-600 text-white hover:bg-red-700"
      >
        <Square className="h-4 w-4" />
      </Button>
    )
  }

  if (isTranscribing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled
        className="h-10 w-10 flex-shrink-0 rounded-xl"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onStart}
      className="h-10 w-10 flex-shrink-0 rounded-xl text-muted-foreground transition-colors hover:text-foreground"
      title="Voice input"
    >
      <Mic className="h-5 w-5" />
    </Button>
  )
}

function ContextControls({
  agents,
  onCreateAgent,
  onSelectAgent,
  selectedAgentId,
  selectedTabs,
  onToggleTab,
  showAgentSelector,
  status,
}: {
  agents: AgentEntry[]
  onCreateAgent?: () => void
  onSelectAgent: (agent: AgentEntry) => void
  selectedAgentId: string | null
  selectedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  showAgentSelector: boolean
  status?: string
}) {
  const { supports } = useCapabilities()
  const { selectedFolder } = useWorkspace()
  const { servers: mcpServers } = useMcpServers()
  const { data: userMCPIntegrations } = useGetUserMCPIntegrations()

  const connectedManagedServers = mcpServers.filter((server) => {
    if (server.type !== 'managed' || !server.managedServerName) return false
    return userMCPIntegrations?.integrations?.find(
      (integration) => integration.name === server.managedServerName,
    )?.is_authenticated
  })

  return (
    <div className="flex items-center justify-between border-border/40 border-t px-4 py-2.5">
      <div className="flex items-center gap-1">
        {showAgentSelector ? (
          <AgentSelector
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            onCreateAgent={onCreateAgent}
            status={status}
          />
        ) : null}
        {supports(Feature.WORKSPACE_FOLDER_SUPPORT) ? (
          <WorkspaceSelector>
            <Button
              variant="ghost"
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm transition-all',
                'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                'data-[state=open]:bg-accent',
              )}
            >
              <Folder className="h-4 w-4" />
              <span>{selectedFolder?.name || 'Add workspace'}</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </WorkspaceSelector>
        ) : null}
        <TabPickerPopover
          variant="selector"
          selectedTabs={selectedTabs}
          onToggleTab={onToggleTab}
        >
          <Button
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm transition-all',
              selectedTabs.length > 0
                ? 'bg-[var(--accent-orange)]! text-white shadow-sm'
                : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              'data-[state=open]:bg-accent',
            )}
          >
            <Layers className="h-4 w-4" />
            <span>Tabs</span>
          </Button>
        </TabPickerPopover>
      </div>

      {supports(Feature.MANAGED_MCP_SUPPORT) ? (
        <div className="ml-auto flex items-center gap-1.5">
          <AppSelector side="bottom">
            <Button
              variant="ghost"
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-sm transition-all',
                'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                'data-[state=open]:bg-accent',
              )}
            >
              <div className="flex items-center -space-x-1.5">
                {connectedManagedServers.slice(0, 4).map((server) => (
                  <div
                    key={server.id}
                    className="rounded-full ring-2 ring-card"
                  >
                    <McpServerIcon
                      serverName={server.managedServerName ?? ''}
                      size={16}
                    />
                  </div>
                ))}
              </div>
              {connectedManagedServers.length > 4 ? (
                <span className="text-xs">
                  +{connectedManagedServers.length - 4}
                </span>
              ) : null}
              <span>Apps</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </AppSelector>
        </div>
      ) : null}
    </div>
  )
}

function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[1.55rem] border border-border/60 bg-card/95 shadow-sm">
      {children}
    </div>
  )
}

function ConversationShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-border/50 bg-background/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-md">
      {children}
    </div>
  )
}

export const ConversationInput: FC<ConversationInputProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onSend,
  onCreateAgent,
  streaming,
  disabled,
  status,
  placeholder,
  variant = 'conversation',
}) => {
  const [input, setInput] = useState('')
  const [selectedTabs, setSelectedTabs] = useState<chrome.tabs.Tab[]>([])
  const [isExpandedDraft, setIsExpandedDraft] = useState(false)
  const voice = useVoiceInput()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedAgent = agents.find(
    (agent) => agent.agentId === selectedAgentId,
  )
  const isConversation = variant === 'conversation'

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return

    const maxHeight = isConversation ? 176 : 100
    const collapsedHeight = isConversation ? 56 : 72
    element.style.height = '0px'
    const nextHeight = Math.min(element.scrollHeight, maxHeight)
    element.style.height = `${nextHeight}px`
    element.style.overflowY =
      element.scrollHeight > maxHeight ? 'auto' : 'hidden'
    setIsExpandedDraft(nextHeight > collapsedHeight)
  })

  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setInput(voice.transcript)
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing, voice])

  const toggleTab = (tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) => {
      const isSelected = prev.some((selected) => selected.id === tab.id)
      if (isSelected) {
        return prev.filter((selected) => selected.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || streaming || disabled) return
    onSend(text)
    setInput('')
  }

  const shell = variant === 'home' ? HomeShell : ConversationShell
  const Shell = shell

  return (
    <Shell>
      <div
        className={cn(
          'flex gap-3',
          variant === 'home' ? 'px-4 py-3' : 'px-4 py-3',
          isExpandedDraft ? 'items-end' : 'items-center',
        )}
      >
        <BotInputIcon variant={variant} />
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            placeholder={
              voice.isTranscribing
                ? 'Transcribing...'
                : (placeholder ??
                  `Message ${selectedAgent?.name ?? 'agent'}...`)
            }
            disabled={disabled || voice.isTranscribing}
            className={cn(
              'resize-none border-none bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0',
              '[field-sizing:fixed]',
              variant === 'home'
                ? 'min-h-[40px] py-2 leading-6'
                : 'min-h-[40px] py-2 leading-6',
              'placeholder:text-muted-foreground/80',
            )}
          />
        </div>
        <VoiceButton
          isRecording={voice.isRecording}
          isTranscribing={voice.isTranscribing}
          onStart={() => {
            void voice.startRecording()
          }}
          onStop={() => {
            void voice.stopRecording()
          }}
        />
        <InputActionButton
          disabled={
            !input.trim() ||
            streaming ||
            !!disabled ||
            voice.isRecording ||
            voice.isTranscribing
          }
          onClick={handleSend}
          streaming={streaming}
        />
      </div>
      {voice.error ? (
        <div className="px-5 pb-2 text-destructive text-xs">{voice.error}</div>
      ) : null}
      <ContextControls
        agents={agents}
        onCreateAgent={onCreateAgent}
        onSelectAgent={onSelectAgent}
        selectedAgentId={selectedAgentId}
        selectedTabs={selectedTabs}
        onToggleTab={toggleTab}
        showAgentSelector={variant === 'home'}
        status={status}
      />
    </Shell>
  )
}

function BotInputIcon({ variant }: { variant: 'home' | 'conversation' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center text-[var(--accent-orange)]',
        variant === 'home'
          ? 'h-8 w-8 rounded-lg bg-[var(--accent-orange)]/10'
          : 'h-8 w-8 rounded-lg bg-[var(--accent-orange)]/10',
      )}
    >
      <Bot className="h-4 w-4" />
    </div>
  )
}
