import { AnimatePresence } from 'motion/react'
import type { FC } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { ComposerProvider } from './ComposerProvider'
import { ChatScreen } from './chat/ChatScreen'
import { NewTabTwo } from './NewTabTwo'

export const NewTabTwoShell: FC = () => {
  const location = useLocation()
  return (
    <ComposerProvider>
      <AnimatePresence mode="popLayout" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route index element={<NewTabTwo />} />
          <Route path="chat" element={<ChatScreen />} />
        </Routes>
      </AnimatePresence>
    </ComposerProvider>
  )
}
