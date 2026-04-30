import { Star } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface PinToggleProps {
  pinned: boolean
  onToggle: (next: boolean) => void
}

export const PinToggle: FC<PinToggleProps> = ({ pinned, onToggle }) => (
  <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'size-6 text-muted-foreground transition-opacity hover:text-foreground',
            // Calm default rail: unpinned stars only appear on hover.
            // Pinned stars stay solid so the "this is pinned" signal is
            // never hidden.
            pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin agent' : 'Pin agent'}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(!pinned)
          }}
        >
          <Star
            className={cn(
              'size-3.5',
              pinned && 'fill-amber-400 text-amber-500',
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {pinned ? 'Unpin' : 'Pin to top'}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)
