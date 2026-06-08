import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Folder,
  Layers,
  Loader2,
  Mic,
  Mic as MicIcon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react'
import { motion } from 'motion/react'
import {
  type FC,
  type FormEventHandler,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { cn } from '@/lib/utils'
import { useComposer } from '../ComposerProvider'
import { POSTS, TONE_NOTES, TRENDS } from './chat-screen.mock-data'
import type { ChatBlock, ThoughtBlock } from './chat-screen.types'

interface AgentChatProps {
  initialMessage?: string
  onSwitchToVoice: () => void
}

const id = (() => {
  let n = 0
  return () => `blk-${++n}`
})()

export const AgentChat: FC<AgentChatProps> = ({
  initialMessage,
  onSwitchToVoice,
}) => {
  const composer = useComposer()
  const [blocks, setBlocks] = useState<ChatBlock[]>(() =>
    initialMessage ? [{ type: 'founder', id: id(), text: initialMessage }] : [],
  )
  const [followupValue, setFollowupValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    composer.reset()
    // Mock-drip the demo beats so the surface has visible motion.
    if (!initialMessage) return
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(
      setTimeout(() => {
        setBlocks((b) => [
          ...b,
          {
            type: 'note',
            id: id(),
            text: "Here's my plan. Starting with research, then I'll learn your voice and draft posts.",
          },
        ])
      }, 300),
    )
    timers.push(
      setTimeout(() => {
        setBlocks((b) => [
          ...b,
          {
            type: 'thought',
            id: id(),
            status: 'running',
            runningLabel: 'Extracting trends',
            items: [
              { text: 'Read the brief and pulled context from your notes' },
              {
                text: 'Reading the automation and AI-agents space',
                running: true,
              },
            ],
          },
        ])
      }, 700),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
    // We deliberately bind this to mount only; mock drip should not re-run on rerender.
  }, [composer.reset, initialMessage])

  useEffect(() => {
    if (!scrollRef.current) return
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  const handleFollowup: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    const text = followupValue.trim()
    if (!text) return
    setBlocks((b) => [...b, { type: 'founder', id: id(), text }])
    setFollowupValue('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between px-6">
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-[13px] text-foreground">
          <BrowserOSIcon size={16} />
          BrowserOS Agent
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </span>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onSwitchToVoice}
            aria-label="Switch to voice"
            className="text-muted-foreground"
          >
            <MicIcon className="size-4" />
          </Button>
          <Plus className="size-[15px]" aria-hidden />
          <Settings className="size-[15px]" aria-hidden />
          <Sun className="size-[15px]" aria-hidden />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-[14px] px-6 pt-3 pb-7">
          {blocks.map((b) => (
            <BlockRenderer key={b.id} block={b} />
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pt-2 pb-[18px]">
        <div className="mb-2 flex items-center gap-2">
          <ComposerPill on>
            <span className="size-[7px] rounded-full bg-[var(--status-working,var(--accent-orange))]" />
            Agent Mode ON
          </ComposerPill>
          <ComposerPill>
            <Layers className="size-3" aria-hidden />
          </ComposerPill>
          <ComposerPill>
            <Folder className="size-3" aria-hidden />
            <span className="size-[7px] rounded-full bg-[var(--accent-orange)]" />
          </ComposerPill>
          <ComposerPill>+2</ComposerPill>
        </div>

        <motion.form
          layoutId="composer-card"
          layout="position"
          onSubmit={handleFollowup}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-[13px] transition-shadow duration-200 focus-within:border-[color-mix(in_oklch,var(--accent-orange)_45%,transparent)] focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent-orange)_12%,transparent)]"
        >
          <Input
            value={followupValue}
            onChange={(e) => setFollowupValue(e.target.value)}
            placeholder="Reply to the agent…"
            aria-label="Reply to the agent"
            className="h-auto w-full rounded-none border-0 bg-transparent p-0 text-[14px] shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Voice"
            className="size-7 rounded-full text-muted-foreground"
          >
            <Mic className="size-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={!followupValue.trim()}
            aria-label="Send"
            className="size-7 rounded-full bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange-bright)]"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </motion.form>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Sub-components — kept private to this module.
 * -------------------------------------------------------------------------*/

const BlockRenderer: FC<{ block: ChatBlock }> = ({ block }) => {
  switch (block.type) {
    case 'founder':
      return <FounderBubble text={block.text} />
    case 'note':
      return <AgentNote text={block.text} />
    case 'thought':
      return <ThoughtGroup block={block} />
    case 'trends':
      return <TrendsCard />
    case 'tone':
      return <ToneCard />
    case 'posts':
      return <PostsCard />
    default:
      return null
  }
}

const FounderBubble: FC<{ text: string }> = ({ text }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="flex justify-end"
  >
    <div className="max-w-[80%] rounded-[14px] bg-secondary px-4 py-2.5 text-[14px] leading-[1.55]">
      {text}
    </div>
  </motion.div>
)

const AgentNote: FC<{ text: string }> = ({ text }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="text-[14.5px] text-foreground leading-[1.6]"
  >
    {text}
  </motion.div>
)

const ThoughtGroup: FC<{ block: ThoughtBlock }> = ({ block }) => {
  const [open, setOpen] = useState(block.status === 'running')
  const done = block.status === 'done'
  const count = block.items.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
      className="overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--card)_60%,transparent)]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-[14px] py-[10px] text-left"
      >
        <Layers className="size-[13px] text-muted-foreground" aria-hidden />
        <span className="flex-1 font-medium text-[13px] text-foreground">
          {done
            ? `${count}/${count} actions completed`
            : block.runningLabel || 'working…'}
        </span>
        {!done && (
          <Loader2
            className="size-[13px] animate-spin text-[var(--accent-orange)]"
            aria-hidden
          />
        )}
        <span className="text-muted-foreground">
          {open ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-[color-mix(in_oklch,var(--border)_40%,transparent)] border-t px-4 pt-2.5 pb-3">
          {block.items.map((item) => (
            <div
              key={`${block.id}-${item.text}`}
              className="flex items-start gap-[9px]"
            >
              <span
                className={cn(
                  'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
                  item.running
                    ? 'bg-[color-mix(in_oklch,var(--accent-orange)_16%,transparent)] text-[var(--accent-orange)]'
                    : 'bg-[color-mix(in_oklch,var(--status-working,var(--accent-orange))_18%,transparent)] text-[oklch(0.4_0.13_145)]',
                )}
                aria-hidden
              >
                {item.running ? (
                  <Loader2 className="size-[11px] animate-spin" />
                ) : (
                  <Check className="size-[11px]" />
                )}
              </span>
              <span className="text-[13px] text-muted-foreground leading-[1.5]">
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {block.note && (
        <div className="px-[14px] pb-3 text-[13px] text-muted-foreground italic">
          {block.note}
        </div>
      )}
    </motion.div>
  )
}

const TrendsCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-[14px]"
  >
    <div className="mb-2.5 flex items-center gap-2 font-semibold text-[13.5px]">
      <span className="flex-1">Trends in the automation space</span>
      <span className="rounded-full bg-muted px-[7px] py-[2px] font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
        {TRENDS.length} themes
      </span>
    </div>
    <ul className="m-0 list-none p-0">
      {TRENDS.map((t) => (
        <li key={t.text} className="mb-1.5 text-[13px] leading-[1.5]">
          <span
            className={cn(
              'mr-2 inline-block rounded-full px-1.5 py-px align-middle font-mono text-[9px] uppercase tracking-[0.08em]',
              t.tag === 'rising' &&
                'bg-[color-mix(in_oklch,var(--accent-orange)_14%,transparent)] text-[var(--accent-orange)]',
              t.tag === 'hot' &&
                'bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] text-destructive',
              t.tag === 'signal' &&
                'bg-[color-mix(in_oklch,var(--tint-blue-fg,#2563EB)_14%,transparent)] text-[var(--tint-blue-fg,#2563EB)]',
            )}
          >
            {t.tag}
          </span>
          {t.text}
        </li>
      ))}
    </ul>
  </motion.div>
)

const ToneCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-[14px]"
  >
    <div className="mb-2.5 font-semibold text-[13.5px]">
      Your voice, learned
    </div>
    <ul className="m-0 flex list-none flex-col gap-[9px] p-0">
      {TONE_NOTES.map((t) => (
        <li key={t} className="flex items-start gap-2 text-[13px]">
          <Check
            className="mt-0.5 size-3 shrink-0 text-[var(--accent-orange)]"
            aria-hidden
          />
          {t}
        </li>
      ))}
    </ul>
  </motion.div>
)

const PostsCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card"
  >
    <div className="flex items-center gap-2 border-[color-mix(in_oklch,var(--border)_50%,transparent)] border-b px-4 py-3 font-semibold text-[13.5px]">
      {POSTS.length} drafts in your voice
    </div>
    {POSTS.map((p, i) => (
      <div
        key={p.id}
        className={cn(
          'border-[color-mix(in_oklch,var(--border)_35%,transparent)] border-b px-4 py-[11px] last:border-0',
          p.pinned &&
            'bg-[color-mix(in_oklch,var(--accent-orange)_5%,transparent)]',
        )}
      >
        <div className="mb-1 flex items-center gap-[9px]">
          <span className="inline-flex size-[19px] items-center justify-center rounded-md bg-secondary font-mono font-semibold text-[11px] text-muted-foreground">
            {i + 1}
          </span>
          <span className="font-semibold text-[13px]">{p.title}</span>
          {p.pinned && (
            <span className="font-semibold text-[10px] text-[var(--accent-orange)]">
              ★ recommended
            </span>
          )}
        </div>
        <div className="pl-7 text-[13px] text-muted-foreground leading-[1.5]">
          {p.bodyFirstLine}
        </div>
      </div>
    ))}
  </motion.div>
)

const ComposerPill: FC<{ children: ReactNode; on?: boolean }> = ({
  children,
  on,
}) => (
  <span
    className={cn(
      'inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full border border-[color-mix(in_oklch,var(--border)_80%,transparent)] px-2.5 text-[11.5px] text-muted-foreground',
      on && 'text-foreground',
    )}
  >
    {children}
  </span>
)
