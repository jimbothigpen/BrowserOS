import type { ToolEntry } from '@/lib/agent-conversations/types'

export function mapAgentHarnessToolStatus(
  status: string | undefined,
): ToolEntry['status'] {
  if (!status) return 'running'
  const normalized = status.toLowerCase()
  if (
    normalized.includes('error') ||
    normalized.includes('fail') ||
    normalized.includes('denied')
  ) {
    return 'error'
  }
  if (
    normalized.includes('complete') ||
    normalized.includes('done') ||
    normalized.includes('success')
  ) {
    return 'completed'
  }
  return 'running'
}
