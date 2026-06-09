import {
  ArrowUp,
  Globe,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  type FC,
  type FormEventHandler,
  type ReactNode,
  useEffect,
  useRef,
} from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AttachDropdown } from './AttachDropdown'
import { useComposer } from './ComposerProvider'

interface ComposerProps {
  autoFocusKey?: string | number | null
  placeholder?: string
  /**
   * Hide the attach affordance (AttachDropdown + chips strip + more-options).
   * Required for the content-script surface, which has no access to
   * `chrome.tabs`. Without this the AttachDropdown crashes on open.
   */
  disableAttachments?: boolean
}

export const Composer: FC<ComposerProps> = ({
  autoFocusKey,
  placeholder = 'Ask anything, or brief your marketing agent…',
  disableAttachments = false,
}) => {
  const {
    value,
    setValue,
    selectedTabs,
    selectedFiles,
    toggleTab,
    addFiles,
    removeTab,
    removeFile,
    voice,
    submit,
    triggerVoice,
    placeholder: ctxPlaceholder,
  } = useComposer()

  const inputRef = useRef<HTMLInputElement>(null)
  const canSend = value.trim().length > 0
  const attachCount = selectedTabs.length + selectedFiles.length
  const effectivePlaceholder = ctxPlaceholder ?? placeholder

  useEffect(() => {
    if (autoFocusKey == null) return
    inputRef.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    if (!voice.transcript) return
    setValue(value ? `${value} ${voice.transcript}` : voice.transcript)
    voice.clearTranscript()
  }, [voice.transcript, setValue, value, voice.clearTranscript])

  const handleSubmit: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    if (!canSend) return
    submit()
  }

  const handleMicToggle = () => {
    if (voice.isRecording) {
      void voice.stopRecording()
      return
    }
    triggerVoice()
  }

  if (disableAttachments) {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-[660px] items-center gap-3 rounded-[22px] border border-transparent bg-white/90 px-5 py-3 transition-shadow duration-200 focus-within:border-[rgba(226,114,44,0.18)] focus-within:shadow-[0_16px_50px_-10px_rgba(226,114,44,0.28),0_0_0_6px_rgba(226,114,44,0.05)]"
      >
        <Search
          className="size-[18px] shrink-0 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={effectivePlaceholder}
          aria-label={effectivePlaceholder}
          className="h-auto w-full min-w-0 rounded-none border-0 bg-transparent p-0 text-[15px] shadow-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_80%,transparent)] focus-visible:border-0 focus-visible:ring-0"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            voice.isRecording ? 'Stop voice input' : 'Start voice input'
          }
          aria-pressed={voice.isRecording}
          disabled={voice.isTranscribing}
          onClick={handleMicToggle}
          className={cn(
            'size-[32px] shrink-0 rounded-full bg-[oklch(0.6781_0.1663_43.21/0.10)] text-[var(--accent-orange)] hover:bg-[oklch(0.6781_0.1663_43.21/0.18)]',
            !voice.isRecording &&
              !voice.isTranscribing &&
              'animate-[nt-mic-pulse_2s_ease-in-out_infinite]',
          )}
        >
          <Mic className="size-4" />
        </Button>
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send"
          className="size-[32px] shrink-0 rounded-full bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange-bright)]"
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[660px] rounded-[22px] border border-transparent bg-white/90 px-5 pt-[18px] pb-3 transition-shadow duration-200 focus-within:border-[rgba(226,114,44,0.18)] focus-within:shadow-[0_16px_50px_-10px_rgba(226,114,44,0.28),0_0_0_6px_rgba(226,114,44,0.05)]"
    >
      <div className="flex items-center gap-3">
        <Search className="size-[18px] text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={effectivePlaceholder}
          aria-label={effectivePlaceholder}
          className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-[16px] shadow-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_80%,transparent)] focus-visible:border-0 focus-visible:ring-0"
        />
      </div>

      <AnimatePresence initial={false}>
        {attachCount > 0 && (
          <motion.div
            key="chips"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {selectedTabs.map((tab) => (
                <AttachChip
                  key={`tab-${tab.id}`}
                  icon={
                    tab.favIconUrl ? (
                      <img
                        src={tab.favIconUrl}
                        alt=""
                        className="size-3 shrink-0 rounded-[2px]"
                      />
                    ) : (
                      <Globe className="size-3 shrink-0" />
                    )
                  }
                  label={tab.title || tab.url || 'Tab'}
                  onRemove={() => removeTab(tab)}
                />
              ))}
              {selectedFiles.map((file) => (
                <AttachChip
                  key={`file-${file.name}-${file.size}-${file.lastModified}`}
                  icon={<Paperclip className="size-3 shrink-0" />}
                  label={file.name}
                  onRemove={() => removeFile(file)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex items-center gap-2">
        <AttachDropdown
          selectedTabs={selectedTabs}
          onToggleTab={toggleTab}
          onAddFiles={addFiles}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 rounded-full bg-black/5 px-[11px] py-[5px] font-normal text-[12.5px] text-muted-foreground hover:bg-black/10"
          >
            <Plus className="size-3.5" aria-hidden />
            Add tabs or files
            {attachCount > 0 && (
              <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[11px] leading-[18px]">
                {attachCount}
              </span>
            )}
          </Button>
        </AttachDropdown>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="More options"
        >
          <MoreHorizontal className="size-[15px]" />
        </Button>

        <span className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            voice.isRecording ? 'Stop voice input' : 'Start voice input'
          }
          aria-pressed={voice.isRecording}
          disabled={voice.isTranscribing}
          onClick={handleMicToggle}
          className={cn(
            'size-[34px] rounded-full bg-[oklch(0.6781_0.1663_43.21/0.10)] text-[var(--accent-orange)] hover:bg-[oklch(0.6781_0.1663_43.21/0.18)]',
            !voice.isRecording &&
              !voice.isTranscribing &&
              'animate-[nt-mic-pulse_2s_ease-in-out_infinite]',
          )}
        >
          <Mic className="size-[17px]" />
        </Button>

        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send"
          className="size-[34px] rounded-full bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange-bright)]"
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------------------
 * Sub-components — kept private to this module.
 * -------------------------------------------------------------------------*/

interface AttachChipProps {
  icon: ReactNode
  label: string
  onRemove: () => void
}

const AttachChip: FC<AttachChipProps> = ({ icon, label, onRemove }) => (
  <span className="inline-flex h-6 max-w-[200px] items-center gap-1.5 rounded-full border border-border bg-white px-2 text-[12px] text-foreground">
    <span className="text-muted-foreground">{icon}</span>
    <span className="min-w-0 truncate">{label}</span>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="-mr-1 size-4 rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground"
    >
      <X className="size-3" />
    </Button>
  </span>
)
