import { type FC, useState } from 'react'
import { Composer } from '@/entrypoints/newtab-2/Composer'
import {
  ComposerProvider,
  useComposer,
} from '@/entrypoints/newtab-2/ComposerProvider'
import { AgentChat } from '@/entrypoints/newtab-2/chat/AgentChat'
import { ChatSessionProvider } from '@/entrypoints/newtab-2/chat/ChatSessionProvider'
import type { ChatMode } from '@/entrypoints/newtab-2/chat/chat-screen.types'
import { VoiceBottom } from '@/entrypoints/newtab-2/chat/VoiceBottom'

export const ContentChat: FC = () => (
  <ComposerProvider>
    <ChatSessionProvider>
      <PopupChat />
    </ChatSessionProvider>
  </ComposerProvider>
)

const PopupChat: FC = () => {
  const [mode, setMode] = useState<ChatMode>('text')
  const { voice } = useComposer()

  const handleSwitchToVoice = () => {
    if (!voice.isRecording) void voice.startRecording()
    setMode('voice')
  }
  const handleSwitchToText = () => {
    if (voice.isRecording) void voice.stopRecording()
    setMode('text')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
      <div className="min-h-0 flex-1">
        <AgentChat compact mode={mode} onSwitchToVoice={handleSwitchToVoice} />
      </div>
      {mode === 'voice' ? (
        <div className="shrink-0 px-4 pb-4">
          <VoiceBottom compact onSwitchToText={handleSwitchToText} />
        </div>
      ) : (
        <div className="shrink-0 border-border border-t bg-background px-4 pt-3 pb-4">
          <Composer disableAttachments placeholder="Reply to the agent…" />
        </div>
      )}
    </div>
  )
}
