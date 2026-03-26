import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash2,
  Loader2,
  MessageSquareText,
  XCircle,
} from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import { cn } from '@/lib/utils'
import { ExecutionStepItem } from './ExecutionStepItem'

dayjs.extend(relativeTime)
dayjs.extend(duration)

function getTaskStatusIcon(status: ExecutionTaskRecord['status']) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />
  }

  if (status === 'running') {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-orange)]" />
    )
  }

  if (status === 'stopped') {
    return <CircleSlash2 className="h-4 w-4 text-orange-500" />
  }

  return <XCircle className="h-4 w-4 text-destructive" />
}

function getTaskStatusLabel(status: ExecutionTaskRecord['status']) {
  if (status === 'completed') return 'Completed'
  if (status === 'running') return 'Running'
  if (status === 'stopped') return 'Stopped'
  if (status === 'interrupted') return 'Interrupted'
  return 'Failed'
}

function formatDuration(task: ExecutionTaskRecord) {
  if (!task.completedAt) return 'In progress'
  const diff = dayjs(task.completedAt).diff(task.startedAt)
  const parsed = dayjs.duration(diff)
  const minutes = Math.floor(parsed.asMinutes())
  const seconds = parsed.seconds()
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

export const ExecutionTaskCard: FC<{
  task: ExecutionTaskRecord
  defaultOpen?: boolean
}> = ({ task, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen)
  const startedAgo = useMemo(
    () => dayjs(task.startedAt).fromNow(),
    [task.startedAt],
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-3 px-5 py-5 text-left"
          >
            <div className="mt-0.5 shrink-0">
              {getTaskStatusIcon(task.status)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="line-clamp-2 font-medium text-base text-foreground">
                  {task.promptText}
                </p>
                <Badge variant="secondary">
                  {getTaskStatusLabel(task.status)}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                <span>{startedAgo}</span>
                <span>•</span>
                <span>{formatDuration(task)}</span>
                <span>•</span>
                <span>{task.actionCount} actions</span>
                {task.approvalCount > 0 && (
                  <span>{task.approvalCount} approvals</span>
                )}
                {task.deniedCount > 0 && <span>{task.deniedCount} denied</span>}
                {task.errorCount > 0 && <span>{task.errorCount} errors</span>}
              </div>
              {task.responsePreview ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-muted-foreground text-sm">
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="line-clamp-3">{task.responsePreview}</p>
                </div>
              ) : null}
            </div>
            <ChevronDown
              className={cn(
                'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-border/60 border-t px-5 py-5">
          {task.steps.length === 0 ? (
            <div className="rounded-xl border border-border/70 border-dashed bg-muted/30 px-4 py-6 text-center text-muted-foreground text-sm">
              No tool actions were recorded for this task.
            </div>
          ) : (
            <div className="space-y-3">
              {task.steps.map((step, index) => (
                <ExecutionStepItem
                  key={step.id}
                  step={step}
                  defaultOpen={
                    task.status === 'running' && index === task.steps.length - 1
                  }
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
