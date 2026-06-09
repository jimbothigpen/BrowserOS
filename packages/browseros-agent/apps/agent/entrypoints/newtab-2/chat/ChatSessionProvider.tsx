import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'
import { DEMO_MODE } from './demo-config'
import { type DemoDirector, useDemoDirector } from './useDemoDirector'

interface ChatSessionContextValue extends DemoDirector {
  hasSession: boolean
}

interface ChatSessionControlsValue {
  initialMessage: string | null
  startSession: (initialMessage: string) => void
  resetSession: () => void
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)
const ChatSessionControlsContext =
  createContext<ChatSessionControlsValue | null>(null)

const EMPTY_SESSION: ChatSessionContextValue = {
  blocks: [],
  gateActive: false,
  founderPlaceholder: null,
  submitFounderReply: () => {},
  hasSession: false,
}

export const ChatSessionProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [initialMessage, setInitialMessage] = useState<string | null>(null)

  const startSession = useCallback((next: string) => {
    setInitialMessage((current) => (current === next ? current : next))
  }, [])

  const resetSession = useCallback(() => {
    setInitialMessage(null)
  }, [])

  return (
    <ChatSessionControlsContext.Provider
      value={{ initialMessage, startSession, resetSession }}
    >
      <SessionScope initialMessage={initialMessage}>{children}</SessionScope>
    </ChatSessionControlsContext.Provider>
  )
}

interface SessionScopeProps {
  initialMessage: string | null
  children: ReactNode
}

const SessionScope: FC<SessionScopeProps> = ({ initialMessage, children }) => {
  // SEAM: swap useDemoDirector for the live streaming hook when DEMO_MODE is off.
  // The hook stays mounted across session starts and resets via its
  // initialMessage-change detection. Critically, the tree shape stays
  // constant so consumers below this provider keep their React identity
  // (and motion's layout baseline) across the launcher to chat handoff.
  const director = useDemoDirector(
    initialMessage ?? undefined,
    !!initialMessage && DEMO_MODE,
  )

  const value: ChatSessionContextValue = initialMessage
    ? { ...director, hasSession: true }
    : EMPTY_SESSION

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export const useChatSession = (): ChatSessionContextValue => {
  const ctx = useContext(ChatSessionContext)
  if (!ctx) {
    throw new Error('useChatSession must be used inside <ChatSessionProvider>')
  }
  return ctx
}

export const useChatSessionControls = (): ChatSessionControlsValue => {
  const ctx = useContext(ChatSessionControlsContext)
  if (!ctx) {
    throw new Error(
      'useChatSessionControls must be used inside <ChatSessionProvider>',
    )
  }
  return ctx
}
