import { Clock, ShieldCheck, ShieldX } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type ApprovalResponse,
  approvalResponsesStorage,
  type PendingApproval,
  pendingToolApprovalsStorage,
  queueApprovalResponse,
} from '@/lib/tool-approvals/approval-sync-storage'

const formatToolName = (name: string) =>
  name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())

export const PendingApprovals: FC = () => {
  const [pending, setPending] = useState<PendingApproval[]>([])

  useEffect(() => {
    pendingToolApprovalsStorage.getValue().then(setPending)
    const unwatch = pendingToolApprovalsStorage.watch(setPending)
    return () => unwatch()
  }, [])

  const respond = async (approvalId: string, approved: boolean) => {
    const response: ApprovalResponse = {
      approvalId,
      approved,
      timestamp: Date.now(),
    }
    const existing = (await approvalResponsesStorage.getValue()) ?? []
    await approvalResponsesStorage.setValue(
      queueApprovalResponse(existing, response),
    )
  }

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 py-12 text-center">
        <ShieldCheck className="mb-3 size-8 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground text-sm">
          No pending approvals
        </p>
        <p className="mt-1 max-w-xs text-muted-foreground/70 text-xs">
          When the agent needs permission to execute a tool, approval requests
          will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pending.map((item) => (
        <div
          key={item.approvalId}
          className="flex items-start gap-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4"
        >
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
            <Clock className="size-4 text-yellow-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                {formatToolName(item.toolName)}
              </span>
              <Badge variant="outline" className="text-[10px]">
                awaiting
              </Badge>
            </div>
            {Object.keys(item.input).length > 0 && (
              <pre className="mt-1 max-h-20 overflow-auto rounded bg-muted/50 p-2 font-mono text-muted-foreground text-xs">
                {JSON.stringify(item.input, null, 2)}
              </pre>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="h-7 gap-1 px-3 text-xs"
                onClick={() => respond(item.approvalId, true)}
              >
                <ShieldCheck className="size-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-3 text-xs"
                onClick={() => respond(item.approvalId, false)}
              >
                <ShieldX className="size-3" />
                Deny
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
