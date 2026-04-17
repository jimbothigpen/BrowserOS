import { useMemo } from 'react'
import {
  useOpenClawMutations,
  useOpenClawStatus,
} from '@/entrypoints/app/agents/useOpenClaw'

export function useOpenClawRuntime() {
  const { status, loading, error, refetch } = useOpenClawStatus()
  const {
    setupOpenClaw,
    startOpenClaw,
    stopOpenClaw,
    restartOpenClaw,
    reconnectOpenClaw,
    actionInProgress,
    settingUp,
    reconnecting,
  } = useOpenClawMutations()

  const gatewayUiState = useMemo(() => {
    if (!status) {
      return {
        canManageAgents: false,
        controlPlaneBusy: false,
        controlPlaneDegraded: false,
      }
    }

    const controlPlaneBusy =
      status.controlPlaneStatus === 'connecting' ||
      status.controlPlaneStatus === 'reconnecting' ||
      status.controlPlaneStatus === 'recovering'

    const canManageAgents =
      status.status === 'running' && status.controlPlaneStatus === 'connected'

    const controlPlaneDegraded =
      status.status === 'running' && status.controlPlaneStatus !== 'connected'

    return {
      canManageAgents,
      controlPlaneBusy,
      controlPlaneDegraded,
    }
  }, [status])

  return {
    status,
    loading,
    error,
    refetch,
    setupOpenClaw,
    startOpenClaw,
    stopOpenClaw,
    restartOpenClaw,
    reconnectOpenClaw,
    actionInProgress,
    settingUp,
    reconnecting,
    ...gatewayUiState,
  }
}
