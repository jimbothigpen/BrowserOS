import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { FC } from 'react'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import type { ClawChatMessage as ClawChatMessageType } from './claw-chat-types'

interface ClawChatMessageProps {
  message: ClawChatMessageType
}

export const ClawChatMessage: FC<ClawChatMessageProps> = ({ message }) => (
  <Message from={message.role}>
    <MessageContent>
      {message.parts.map((part, index) => {
        const key = `${message.id}-part-${index}`

        switch (part.type) {
          case 'text':
            return <MessageResponse key={key}>{part.text}</MessageResponse>

          case 'reasoning':
            return (
              <Reasoning key={key} className="w-full" defaultOpen={false}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            )

          case 'tool-call':
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                {part.status === 'running' || part.status === 'pending' ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : null}
                {part.status === 'completed' ? (
                  <CheckCircle2 className="size-3.5 text-green-500" />
                ) : null}
                {part.status === 'failed' ? (
                  <XCircle className="size-3.5 text-destructive" />
                ) : null}
                <span className="font-mono text-xs">{part.name}</span>
                {part.error ? (
                  <span className="ml-auto text-destructive text-xs">
                    {part.error}
                  </span>
                ) : null}
              </div>
            )

          case 'meta':
            return (
              <div key={key} className="text-muted-foreground text-xs">
                {part.label}: {part.value}
              </div>
            )

          default:
            return null
        }
      })}
    </MessageContent>
  </Message>
)
