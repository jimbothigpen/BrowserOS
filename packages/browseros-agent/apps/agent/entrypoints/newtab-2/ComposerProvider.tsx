import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'
import { useNavigate } from 'react-router'
import {
  type UseVoiceInputReturn,
  useVoiceInput,
} from '@/lib/voice/useVoiceInput'
import type { ChatMode } from './chat/chat-screen.types'

interface ComposerContextValue {
  value: string
  setValue: (next: string) => void
  selectedTabs: chrome.tabs.Tab[]
  selectedFiles: File[]
  toggleTab: (tab: chrome.tabs.Tab) => void
  addFiles: (files: File[]) => void
  removeTab: (tab: chrome.tabs.Tab) => void
  removeFile: (file: File) => void
  reset: () => void
  voice: UseVoiceInputReturn
  submittedAt: number | null
  transitionIntent: ChatMode | null
  setTransitionIntent: (intent: ChatMode | null) => void
  submitToChat: (mode: ChatMode) => void
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

export const ComposerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [value, setValue] = useState('')
  const [selectedTabs, setSelectedTabs] = useState<chrome.tabs.Tab[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [transitionIntent, setTransitionIntent] = useState<ChatMode | null>(
    null,
  )
  const voice = useVoiceInput()
  const navigate = useNavigate()

  const toggleTab = useCallback((tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) =>
      prev.some((t) => t.id === tab.id)
        ? prev.filter((t) => t.id !== tab.id)
        : [...prev, tab],
    )
  }, [])

  const addFiles = useCallback((files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files])
  }, [])

  const removeTab = useCallback((tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) => prev.filter((t) => t.id !== tab.id))
  }, [])

  const removeFile = useCallback((file: File) => {
    setSelectedFiles((prev) => prev.filter((f) => f !== file))
  }, [])

  const reset = useCallback(() => {
    setValue('')
    setSelectedTabs([])
    setSelectedFiles([])
    setSubmittedAt(null)
    setTransitionIntent(null)
  }, [])

  const submitToChat = useCallback(
    (mode: ChatMode) => {
      setSubmittedAt(Date.now())
      setTransitionIntent(mode)
      if (mode === 'voice') {
        void voice.startRecording()
      }
      navigate(`/newtab-2/chat?mode=${mode}`, {
        state: {
          initialMessage: value,
          initialMode: mode,
          initialVoice: mode === 'voice',
        },
      })
    },
    [navigate, value, voice.startRecording],
  )

  return (
    <ComposerContext.Provider
      value={{
        value,
        setValue,
        selectedTabs,
        selectedFiles,
        toggleTab,
        addFiles,
        removeTab,
        removeFile,
        reset,
        voice,
        submittedAt,
        transitionIntent,
        setTransitionIntent,
        submitToChat,
      }}
    >
      {children}
    </ComposerContext.Provider>
  )
}

export const useComposer = (): ComposerContextValue => {
  const ctx = useContext(ComposerContext)
  if (!ctx) {
    throw new Error('useComposer must be used inside <ComposerProvider>')
  }
  return ctx
}
