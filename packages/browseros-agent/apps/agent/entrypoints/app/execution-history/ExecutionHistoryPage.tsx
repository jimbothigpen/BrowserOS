import dayjs from 'dayjs'
import {
  AlertTriangle,
  Loader2,
  type LucideIcon,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { ExecutionTaskCard } from '@/components/execution-history/ExecutionTaskCard'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useExecutionHistoryByConversation } from '@/lib/execution-history/storage'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'

type TaskFilter = 'all' | 'active' | 'issues'

type TaskGroup = {
  label: string
  tasks: ExecutionTaskRecord[]
}

type SummaryStatProps = {
  title: string
  value: string
  description: string
  icon: LucideIcon
}

function isIssueTask(task: ExecutionTaskRecord) {
  return (
    task.status === 'failed' ||
    task.status === 'stopped' ||
    task.status === 'interrupted' ||
    task.deniedCount > 0 ||
    task.errorCount > 0
  )
}

function matchesTaskFilter(task: ExecutionTaskRecord, filter: TaskFilter) {
  if (filter === 'active') {
    return task.status === 'running'
  }

  if (filter === 'issues') {
    return isIssueTask(task)
  }

  return true
}

function matchesSearch(task: ExecutionTaskRecord, query: string) {
  if (!query) return true

  const haystack = [
    task.promptText,
    task.responsePreview ?? '',
    ...task.steps.map((step) => `${step.toolName} ${step.previewText}`),
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
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

const SummaryStatCard: FC<SummaryStatProps> = ({
  title,
  value,
  description,
  icon: Icon,
}) => {
  return (
    <Card className="gap-3 border-border/60 bg-card/95 py-4 shadow-sm">
      <CardHeader className="gap-3 px-4 pb-0">
        <div className="flex items-center justify-between">
          <CardDescription>{title}</CardDescription>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-orange)]/10">
            <Icon className="h-4 w-4 text-[var(--accent-orange)]" />
          </div>
        </div>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-muted-foreground text-sm">
        {description}
      </CardContent>
    </Card>
  )
}

export const ExecutionHistoryPage: FC = () => {
  const historyByConversation = useExecutionHistoryByConversation()
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [searchValue, setSearchValue] = useState('')

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

  const filteredTasks = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase()
    return tasks.filter(
      (task) =>
        matchesTaskFilter(task, filter) &&
        matchesSearch(task, normalizedSearch),
    )
  }, [filter, searchValue, tasks])

  const groupedTasks = useMemo(() => groupTasks(filteredTasks), [filteredTasks])

  const totalActions = tasks.reduce(
    (total, task) => total + task.actionCount,
    0,
  )
  const runningCount = tasks.filter((task) => task.status === 'running').length
  const issueCount = tasks.filter(isIssueTask).length
  const conversationCount = historyList.length

  return (
    <div className="fade-in slide-in-from-bottom-5 mx-auto w-full max-w-5xl animate-in space-y-6 duration-500">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Badge
              variant="outline"
              className="border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 text-[var(--accent-orange)]"
            >
              Trust Surface
            </Badge>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-orange)]/10">
                <ShieldCheck className="h-6 w-6 text-[var(--accent-orange)]" />
              </div>
              <div className="space-y-1">
                <h1 className="font-semibold text-3xl tracking-tight">
                  Execution History
                </h1>
                <p className="max-w-2xl text-muted-foreground text-sm">
                  Review what BrowserOS actually did for every task, including
                  tool steps, approvals, denials, and failures, without
                  cluttering the assistant while it is running.
                </p>
              </div>
            </div>
          </div>
          {runningCount > 0 && (
            <Badge className="gap-2 rounded-full px-3 py-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {runningCount} live run{runningCount === 1 ? '' : 's'}
            </Badge>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStatCard
            title="Tasks"
            value={String(tasks.length)}
            description={`${conversationCount} chat session${conversationCount === 1 ? '' : 's'} captured`}
            icon={Wand2}
          />
          <SummaryStatCard
            title="Actions"
            value={String(totalActions)}
            description="Recorded browser and app tool steps"
            icon={Sparkles}
          />
          <SummaryStatCard
            title="Issues"
            value={String(issueCount)}
            description="Failed, stopped, denied, or blocked tasks"
            icon={AlertTriangle}
          />
          <SummaryStatCard
            title="Active"
            value={String(runningCount)}
            description="Runs still streaming in the background"
            icon={Loader2}
          />
        </div>
      </div>

      <Card className="gap-4 border-border/60 bg-card/95 py-4 shadow-sm">
        <CardHeader className="gap-4 px-4 pb-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg">Browse activity</CardTitle>
              <CardDescription>
                Search prompts, responses, and tool names across all recorded
                runs.
              </CardDescription>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search prompts, responses, or tools"
                className="pl-9"
              />
            </div>
          </div>
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as TaskFilter)}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>

        <CardContent className="px-4">
          {tasks.length === 0 ? (
            <div className="rounded-2xl border border-border/70 border-dashed bg-muted/20 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm">
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              </div>
              <h2 className="mt-4 font-medium text-lg">
                No execution history yet
              </h2>
              <p className="mt-2 text-muted-foreground text-sm">
                Run a task in BrowserOS and the execution trace will show up
                here.
              </p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-2xl border border-border/70 border-dashed bg-muted/20 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm">
                <Search className="h-5 w-5 text-muted-foreground" />
              </div>
              <h2 className="mt-4 font-medium text-lg">No matching tasks</h2>
              <p className="mt-2 text-muted-foreground text-sm">
                Try a different search or switch filters to see more history.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {groupedTasks.map((group, groupIndex) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.2em]">
                      {group.label}
                    </h2>
                    <div className="h-px flex-1 bg-border/60" />
                    <span className="text-muted-foreground text-xs">
                      {group.tasks.length} task
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
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
