import type { OpenClawStatus } from './useOpenClaw'

export type OpenClawOperatorState =
  | 'loading'
  | 'setup-needed'
  | 'starting'
  | 'healthy'
  | 'needs-attention'

export interface OpenClawOperatorStateResult {
  kind: OpenClawOperatorState
}

const TRANSIENT_CONTROL_PLANE_STATUSES = new Set<
  OpenClawStatus['controlPlaneStatus']
>(['connecting', 'reconnecting', 'recovering'])

export function getOpenClawOperatorState(
  status: OpenClawStatus | null | undefined,
): OpenClawOperatorStateResult {
  if (!status) return { kind: 'loading' }
  if (status.status === 'uninitialized') return { kind: 'setup-needed' }
  if (
    status.status === 'running' &&
    status.controlPlaneStatus === 'connected'
  ) {
    return { kind: 'healthy' }
  }
  if (
    status.status === 'starting' ||
    TRANSIENT_CONTROL_PLANE_STATUSES.has(status.controlPlaneStatus)
  ) {
    return { kind: 'starting' }
  }
  return { kind: 'needs-attention' }
}
