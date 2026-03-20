import { CheckIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type FC, useState } from 'react'
import { i18n } from '#i18n'
import { MessageAction, MessageActions } from '@/components/ai-elements/message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SIDEPANEL_MESSAGE_COPIED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'

interface ChatMessageActionsProps {
  messageId: string
  messageText: string
  liked: boolean
  disliked: boolean
  onClickLike: () => void
  onClickDislike: (comment?: string) => void
}

export const ChatMessageActions: FC<ChatMessageActionsProps> = ({
  messageId,
  messageText,
  liked,
  disliked,
  onClickLike,
  onClickDislike,
}) => {
  const [dislikeDialogOpen, setDislikeDialogOpen] = useState(false)
  const [dislikeComment, setDislikeComment] = useState('')

  const feedbackSubmitted = liked || disliked

  const handleLike = () => {
    onClickLike()
  }

  const handleDislikeClick = () => {
    setDislikeDialogOpen(true)
  }

  const handleDislikeSubmit = () => {
    onClickDislike(dislikeComment.trim() || undefined)
    setDislikeDialogOpen(false)
    setDislikeComment('')
  }

  const handleDislikeCancel = () => {
    setDislikeDialogOpen(false)
    setDislikeComment('')
  }

  return (
    <MessageActions>
      <MessageAction
        onClick={() => {
          navigator.clipboard.writeText(messageText)
          track(SIDEPANEL_MESSAGE_COPIED_EVENT)
        }}
        label={i18n.t('chat.actions.copy')}
        tooltip={i18n.t('chat.actions.copyToClipboard')}
      >
        <CopyIcon className="size-3" />
      </MessageAction>
      <AnimatePresence mode="wait" initial={false}>
        {feedbackSubmitted ? (
          <motion.div
            key={`${messageId}-feedback-submitted`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1 text-muted-foreground text-xs"
          >
            <CheckIcon className="size-3" />
            <span>{i18n.t('chat.actions.feedbackSubmitted')}</span>
          </motion.div>
        ) : (
          <motion.div
            key={`${messageId}-feedback-actions`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1"
          >
            <MessageAction
              label={i18n.t('chat.actions.like')}
              onClick={handleLike}
              tooltip={i18n.t('chat.actions.likeTooltip')}
            >
              <ThumbsUpIcon
                className="size-4"
                fill={liked ? 'currentColor' : 'none'}
              />
            </MessageAction>
            <MessageAction
              label={i18n.t('chat.actions.dislike')}
              onClick={handleDislikeClick}
              tooltip={i18n.t('chat.actions.dislikeTooltip')}
            >
              <ThumbsDownIcon
                className="size-4"
                fill={disliked ? 'currentColor' : 'none'}
              />
            </MessageAction>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={dislikeDialogOpen} onOpenChange={setDislikeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t('chat.actions.feedbackTitle')}</DialogTitle>
            <DialogDescription>
              {i18n.t('chat.actions.feedbackDescription')}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={i18n.t('chat.actions.feedbackPlaceholder')}
            value={dislikeComment}
            onChange={(e) => setDislikeComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleDislikeSubmit()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleDislikeCancel}>
              {i18n.t('common.cancel')}
            </Button>
            <Button onClick={handleDislikeSubmit}>
              {i18n.t('common.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MessageActions>
  )
}
