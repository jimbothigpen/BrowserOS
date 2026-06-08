import { AnimatePresence, motion } from 'motion/react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useComposer } from '../ComposerProvider'
import { AgentChat } from './AgentChat'
import type { ChatMode } from './chat-screen.types'
import { VoiceMode } from './VoiceMode'

interface ChatLocationState {
  initialMessage?: string
  initialMode?: ChatMode
  initialVoice?: boolean
}

export const ChatScreen: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const composer = useComposer()
  const { voice, setTransitionIntent } = composer

  const state = (location.state ?? null) as ChatLocationState | null
  const queryMode = searchParams.get('mode') as ChatMode | null
  const [mode, setMode] = useState<ChatMode>(
    state?.initialMode ?? queryMode ?? 'text',
  )
  const [initialMessage] = useState<string>(
    state?.initialMessage ?? composer.value ?? '',
  )

  useEffect(() => {
    setTransitionIntent(null)
  }, [setTransitionIntent])

  const switchTo = useCallback(
    (next: ChatMode) => {
      if (next === 'voice' && !voice.isRecording) {
        void voice.startRecording()
      }
      if (next === 'text' && voice.isRecording) {
        void voice.stopRecording()
      }
      setMode(next)
      const params = new URLSearchParams(searchParams)
      params.set('mode', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams, voice],
  )

  const handleClose = useCallback(() => {
    if (voice.isRecording) void voice.stopRecording()
    navigate('/newtab-2')
  }, [navigate, voice])

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'voice' ? (
          <motion.div
            key="voice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.18 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="h-full"
          >
            <VoiceMode
              initialListening={state?.initialVoice ?? true}
              onSwitchToText={() => switchTo('text')}
              onClose={handleClose}
            />
          </motion.div>
        ) : (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="h-full"
          >
            <AgentChat
              initialMessage={initialMessage}
              onSwitchToVoice={() => switchTo('voice')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
