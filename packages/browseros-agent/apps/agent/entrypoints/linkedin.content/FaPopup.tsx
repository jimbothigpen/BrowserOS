import { X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { FC } from 'react'
import { ChatLayoutShell } from './ChatLayoutShell'
import { LAUNCHER_SIZE, type LauncherPosition } from './content-script.types'

interface FaPopupProps {
  anchor: LauncherPosition
  onClose: () => void
}

const POPUP_WIDTH = 380
const POPUP_HEIGHT = 520
const POPUP_GAP = 12
const EASE = [0.32, 0.72, 0, 1] as const

interface PopupPlacement {
  left: number
  top: number
  openAbove: boolean
}

function popupAnchor(anchor: LauncherPosition): PopupPlacement {
  const launcherCenterX = anchor.x + LAUNCHER_SIZE / 2
  const proposedLeft = launcherCenterX - POPUP_WIDTH / 2
  const left = Math.min(
    Math.max(12, proposedLeft),
    Math.max(12, window.innerWidth - POPUP_WIDTH - 12),
  )
  const proposedTop = anchor.y - POPUP_HEIGHT - POPUP_GAP
  const openAbove = proposedTop > 12
  const top = openAbove ? proposedTop : anchor.y + LAUNCHER_SIZE + POPUP_GAP
  return { left, top, openAbove }
}

export const FaPopup: FC<FaPopupProps> = ({ anchor, onClose }) => {
  const reducedMotion = useReducedMotion()
  const { left, top, openAbove } = popupAnchor(anchor)
  const launcherCenterX = anchor.x + LAUNCHER_SIZE / 2
  const originX = Math.min(Math.max(0, launcherCenterX - left), POPUP_WIDTH)
  const originY = openAbove ? POPUP_HEIGHT : 0
  const yStart = openAbove ? 6 : -6

  const initial = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.92, y: yStart }
  const animate = reducedMotion
    ? { opacity: 1, transition: { duration: 0.08 } }
    : { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: EASE } }
  const exit = reducedMotion
    ? { opacity: 0, transition: { duration: 0.06 } }
    : {
        opacity: 0,
        scale: 0.92,
        y: yStart,
        transition: { duration: 0.14, ease: EASE },
      }

  return (
    <motion.div
      initial={initial}
      animate={animate}
      exit={exit}
      style={{
        left,
        top,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        transformOrigin: `${originX}px ${originY}px`,
      }}
      className="fixed z-[2147483647] flex flex-col overflow-hidden rounded-[18px] bg-background shadow-[0_28px_70px_-16px_rgba(30,30,50,0.40),0_0_0_1px_rgba(0,0,0,0.06)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close BrowserOS chat"
        className="absolute top-[11px] right-3 z-[3] inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
      <ChatLayoutShell />
    </motion.div>
  )
}
