import { AnimatePresence } from 'motion/react'
import type { FC } from 'react'
import { FaLaunch } from './FaLaunch'
import { FaPopup } from './FaPopup'
import {
  LauncherStateProvider,
  useLauncherState,
} from './LauncherStateProvider'

export const ContentChatApp: FC = () => (
  <LauncherStateProvider>
    <LauncherView />
  </LauncherStateProvider>
)

const LauncherView: FC = () => {
  const { position, popupOpen, beginDrag, closePopup } = useLauncherState()
  return (
    <>
      <FaLaunch position={position} onPointerDown={beginDrag} />
      <AnimatePresence>
        {popupOpen && (
          <FaPopup key="popup" anchor={position} onClose={closePopup} />
        )}
      </AnimatePresence>
    </>
  )
}
