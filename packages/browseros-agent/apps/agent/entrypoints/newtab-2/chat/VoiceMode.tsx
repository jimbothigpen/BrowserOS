import { MessageSquare, Mic, Settings, X } from 'lucide-react'
import { motion } from 'motion/react'
import { type FC, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useComposer } from '../ComposerProvider'
import { VOICE_TURNS } from './chat-screen.mock-data'
import type { VoiceTurn } from './chat-screen.types'
import { VoiceOrb, type VoiceOrbState } from './VoiceOrb'

interface VoiceModeProps {
  initialListening: boolean
  onSwitchToText: () => void
  onClose: () => void
}

export const VoiceMode: FC<VoiceModeProps> = ({
  initialListening,
  onSwitchToText,
  onClose,
}) => {
  const composer = useComposer()
  const { voice } = composer
  const scrollRef = useRef<HTMLDivElement>(null)

  const turns: VoiceTurn[] = useMemo(() => {
    const count = Math.min(VOICE_TURNS.length, initialListening ? 1 : 0)
    return VOICE_TURNS.slice(0, count)
  }, [initialListening])

  const last = turns[turns.length - 1]
  const orbState: VoiceOrbState = !last
    ? voice.isRecording
      ? 'listening'
      : 'idle'
    : last.who === 'agent'
      ? 'speaking'
      : 'listening'

  const caption = !last
    ? voice.isRecording
      ? 'Listening…'
      : 'Connecting…'
    : last.who === 'agent'
      ? last.text
      : 'Listening…'

  const listeningCaption =
    !last || last.who === 'founder' || (!turns.length && voice.isRecording)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  const handleMicToggle = () => {
    if (voice.isRecording) {
      void voice.stopRecording()
    } else {
      void voice.startRecording()
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center bg-[radial-gradient(90%_70%_at_50%_50%,#FCEFE4_0%,var(--background)_70%)] px-0 pt-4 pb-[26px]">
      <div className="flex w-full items-center justify-between px-[22px] text-muted-foreground">
        <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px]">
          <span className="size-[7px] animate-[fv-pulse_1.5s_ease-in-out_infinite] rounded-full bg-[var(--accent-orange)]" />
          Voice · BrowserOS agent
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onSwitchToText}
            aria-label="Switch to text"
            className="text-muted-foreground"
          >
            <MessageSquare className="size-4" />
          </Button>
          <Settings className="size-[17px] text-muted-foreground" aria-hidden />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 w-[600px] flex-1 flex-col gap-[14px] overflow-y-auto py-[18px]"
      >
        {turns.slice(0, -1).map((t) => (
          <TranscriptTurn
            key={`${t.who}-${t.text}`}
            turn={t}
            founderFirst="You"
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{
          opacity: 1,
          scale: 1,
          transition: { duration: 0.18, ease: 'easeOut' },
        }}
        className="shrink-0"
      >
        <VoiceOrb size={232} state={orbState} accent="#E8722E" />
      </motion.div>

      <p
        className={cn(
          'mt-1.5 min-h-[26px] max-w-[560px] px-5 text-center font-medium text-[17px] text-[var(--accent-orange)] leading-[1.45]',
          listeningCaption && 'font-normal text-muted-foreground italic',
        )}
      >
        {caption}
      </p>

      <div className="mt-5 flex gap-[26px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close voice"
          className="size-14 rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white"
        >
          <X className="size-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleMicToggle}
          aria-label={voice.isRecording ? 'Stop listening' : 'Start listening'}
          aria-pressed={voice.isRecording}
          className={cn(
            'size-14 rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white',
            voice.isRecording &&
              'bg-[var(--accent-orange)] text-white shadow-[0_0_0_6px_rgba(226,114,44,0.18)] hover:bg-[var(--accent-orange-bright)]',
          )}
        >
          <Mic className="size-[22px]" />
        </Button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Sub-components — kept private to this module.
 * -------------------------------------------------------------------------*/

const TranscriptTurn: FC<{ turn: VoiceTurn; founderFirst: string }> = ({
  turn,
  founderFirst,
}) => (
  <div
    className={cn(
      'max-w-[80%]',
      turn.who === 'agent' ? 'self-start' : 'self-end text-right',
    )}
  >
    <div className="mb-1 font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.14em]">
      {turn.who === 'agent' ? 'Agent' : founderFirst}
    </div>
    <div className="inline-block rounded-[14px] bg-secondary px-[15px] py-[9px] text-left text-[14.5px] text-foreground leading-[1.5]">
      {turn.text}
    </div>
  </div>
)
