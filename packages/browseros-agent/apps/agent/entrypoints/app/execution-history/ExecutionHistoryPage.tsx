import dayjs from 'dayjs'
import { Loader2, ShieldCheck } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ExecutionTaskCard } from '@/components/execution-history/ExecutionTaskCard'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  removeConversationExecutionTask,
  useExecutionHistoryByConversation,
} from '@/lib/execution-history/storage'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'

type TaskGroup = {
  label: string
  tasks: ExecutionTaskRecord[]
}

function getGroupLabel(date: string) {
  const startedAt = dayjs(date)
  if (startedAt.isSame(dayjs(), 'day')) return 'Today'
  if (startedAt.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday'
  return startedAt.format('MMMM D, YYYY')
}

function groupTasks(tasks: ExecutionTaskRecord[]): TaskGroup[] {
  const grouped = new Map<string, ExecutionTaskRecord[]>()

  for (const task of tasks) {
    const label = getGroupLabel(task.startedAt)
    const existing = grouped.get(label) ?? []
    grouped.set(label, [...existing, task])
  }

  return Array.from(grouped.entries()).map(([label, groupItems]) => ({
    label,
    tasks: groupItems,
  }))
}

export const ExecutionHistoryPage: FC = () => {
  const historyByConversation = useExecutionHistoryByConversation()
  const [taskToDelete, setTaskToDelete] = useState<ExecutionTaskRecord | null>(
    null,
  )

  const historyList = useMemo(
    () => Object.values(historyByConversation),
    [historyByConversation],
  )

  const tasks = useMemo(() => {
    return historyList
      .flatMap((history) => history.tasks)
      .sort(
        (left, right) =>
          new Date(right.startedAt).getTime() -
          new Date(left.startedAt).getTime(),
      )
  }, [historyList])

  const groupedTasks = useMemo(() => groupTasks(tasks), [tasks])
  const runningCount = tasks.filter((task) => task.status === 'running').length
  const conversationCount = historyList.length

  const handleDeleteTask = async () => {
    if (!taskToDelete) return

    try {
      await removeConversationExecutionTask({
        conversationId: taskToDelete.conversationId,
        taskId: taskToDelete.id,
      })
      toast.success('Run removed')
    } catch {
      toast.error('Failed to remove run')
    } finally {
      setTaskToDelete(null)
    }
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 mx-auto w-full max-w-4xl animate-in space-y-8 duration-500">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-orange)]/10">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-orange)]" />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-semibold text-3xl tracking-tight">Audit</h1>
              {runningCount > 0 && (
                <Badge className="gap-2 rounded-full px-3 py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {runningCount} live run{runningCount === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            <p className="max-w-2xl text-muted-foreground text-sm">
              Review what BrowserOS actually did for each run, including tools,
              approvals, denials, and failures.
            </p>
            {tasks.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {tasks.length} recorded run{tasks.length === 1 ? '' : 's'}
                {conversationCount > 1
                  ? ` across ${conversationCount} chats`
                  : ''}
              </p>
            )}
          </div>
        </div>
      </section>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-border/70 border-dashed bg-muted/20 px-6 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="mt-4 font-medium text-lg">No agent runs yet</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Run a task in BrowserOS and the audit feed will appear here.
          </p>
        </div>
      ) : (
        <section className="space-y-6">
          <div>
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
              Recent runs
            </h2>
            <p className="mt-2 text-muted-foreground text-sm">
              Newest first. Remove any run you no longer want to keep locally.
            </p>
          </div>

          <div className="space-y-8">
            {groupedTasks.map((group, groupIndex) => (
              <section key={group.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="text-muted-foreground text-xs">
                    {group.tasks.length} run
                    {group.tasks.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-4">
                  {group.tasks.map((task, index) => (
                    <ExecutionTaskCard
                      key={task.id}
                      task={task}
                      defaultOpen={
                        task.status === 'running' ||
                        (groupIndex === 0 && index === 0)
                      }
                      onDelete={setTaskToDelete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      <AlertDialog
        open={taskToDelete !== null}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Run</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{taskToDelete?.promptText}" from local audit history? This
              only clears the recorded run on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTask}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
