import { describe, expect, it } from 'bun:test'
import { getOpenClawOperatorState } from './openclaw-operator-state'
import type { OpenClawStatus } from './useOpenClaw'

function buildStatus(overrides: Partial<OpenClawStatus>): OpenClawStatus {
  return {
    status: 'running',
    podmanAvailable: true,
    machineReady: true,
    port: 18789,
    agentCount: 1,
    error: null,
    controlPlaneStatus: 'connected',
    lastGatewayError: null,
    lastRecoveryReason: null,
    ...overrides,
  }
}

describe('getOpenClawOperatorState', () => {
  it('returns setup-needed when OpenClaw is uninitialized', () => {
    const state = getOpenClawOperatorState(
      buildStatus({ status: 'uninitialized', port: null }),
    )

    expect(state.kind).toBe('setup-needed')
  })

  it('returns needs-attention for degraded or failed runtime states', () => {
    const cases = [
      buildStatus({
        status: 'running',
        controlPlaneStatus: 'failed',
        lastGatewayError: 'Gateway recovery failed',
      }),
      buildStatus({
        status: 'error',
        controlPlaneStatus: 'failed',
        error: 'Gateway error',
      }),
      buildStatus({
        status: 'stopped',
        controlPlaneStatus: 'disconnected',
      }),
    ]

    for (const status of cases) {
      const state = getOpenClawOperatorState(status)
      expect(state.kind).toBe('needs-attention')
    }
  })

  it('returns healthy when the runtime and control plane are connected', () => {
    const state = getOpenClawOperatorState(buildStatus())

    expect(state.kind).toBe('healthy')
  })

  it('keeps transient reconnecting states separate from needs-attention', () => {
    const state = getOpenClawOperatorState(
      buildStatus({
        status: 'running',
        controlPlaneStatus: 'reconnecting',
      }),
    )

    expect(state.kind).toBe('starting')
  })

  it('treats transient control-plane states as needs-attention when runtime is stopped or error', () => {
    const stoppedState = getOpenClawOperatorState(
      buildStatus({
        status: 'stopped',
        controlPlaneStatus: 'recovering',
      }),
    )
    const errorState = getOpenClawOperatorState(
      buildStatus({
        status: 'error',
        controlPlaneStatus: 'reconnecting',
      }),
    )

    expect(stoppedState.kind).toBe('needs-attention')
    expect(errorState.kind).toBe('needs-attention')
  })
})
