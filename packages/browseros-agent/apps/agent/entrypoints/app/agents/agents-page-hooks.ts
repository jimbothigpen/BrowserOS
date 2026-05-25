import { type Dispatch, type SetStateAction, useEffect, useMemo } from 'react'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import type {
  HarnessAdapterDescriptor,
  HarnessAgentAdapter,
} from './agent-harness-types'
import type { CreateAgentRuntime, ProviderOption } from './agents-page-types'
import { getHermesSupportedProviders } from './hermes-supported-providers'

export function useDefaultAgentName(
  createOpen: boolean,
  setNewName: Dispatch<SetStateAction<string>>,
): void {
  useEffect(() => {
    if (!createOpen) return
    setNewName((current) => current || 'agent')
  }, [createOpen, setNewName])
}

export function useHarnessAgentDefaults(input: {
  adapters: HarnessAdapterDescriptor[]
  createOpen: boolean
  harnessAdapterId: HarnessAgentAdapter
  setHarnessAdapterId: Dispatch<SetStateAction<HarnessAgentAdapter>>
  setHarnessModelId: Dispatch<SetStateAction<string>>
  setHarnessReasoningEffort: Dispatch<SetStateAction<string>>
}): void {
  const {
    adapters,
    createOpen,
    harnessAdapterId,
    setHarnessAdapterId,
    setHarnessModelId,
    setHarnessReasoningEffort,
  } = input

  useEffect(() => {
    if (!createOpen) return
    const adapter =
      adapters.find((entry) => entry.id === harnessAdapterId) ?? adapters[0]
    if (!adapter) return
    setHarnessAdapterId(adapter.id)
    setHarnessModelId((current) => current || adapter.defaultModelId)
    setHarnessReasoningEffort(
      (current) => current || adapter.defaultReasoningEffort,
    )
  }, [
    adapters,
    createOpen,
    harnessAdapterId,
    setHarnessAdapterId,
    setHarnessModelId,
    setHarnessReasoningEffort,
  ])
}

export function useHermesProviderSelection(input: {
  providers: LlmProviderConfig[]
  defaultProviderId: string
  createOpen: boolean
  createRuntime: CreateAgentRuntime
  createHermesProviderId: string
  setCreateHermesProviderId: Dispatch<SetStateAction<string>>
}) {
  const {
    providers,
    defaultProviderId,
    createOpen,
    createRuntime,
    createHermesProviderId,
    setCreateHermesProviderId,
  } = input

  const selectableHermesProviders = useMemo<ProviderOption[]>(
    () =>
      getHermesSupportedProviders(providers).map((provider) => ({
        id: provider.id,
        type: provider.type,
        name: provider.name,
        modelId: provider.modelId,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      })),
    [providers],
  )

  useEffect(() => {
    if (selectableHermesProviders.length === 0) return
    if (!createOpen || createRuntime !== 'hermes') return
    if (createHermesProviderId) return
    const fallbackId =
      selectableHermesProviders.find((p) => p.id === defaultProviderId)?.id ??
      selectableHermesProviders[0].id
    setCreateHermesProviderId(fallbackId)
  }, [
    createHermesProviderId,
    createOpen,
    createRuntime,
    defaultProviderId,
    selectableHermesProviders,
    setCreateHermesProviderId,
  ])

  return { selectableHermesProviders }
}
