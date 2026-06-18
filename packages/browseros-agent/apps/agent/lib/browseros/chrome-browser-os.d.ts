// biome-ignore-all lint/suspicious/noExplicitAny: Browser API type definitions require flexible types
declare namespace chrome.browserOS {
  interface PrefObject {
    key: string
    type: string
    value: any
  }

  function getPref(name: string, callback: (pref: PrefObject) => void): void

  function setPref(
    name: string,
    value: any,
    pageId: string,
    callback: (success: boolean) => void,
  ): void
  function setPref(
    name: string,
    value: any,
    callback: (success: boolean) => void,
  ): void

  function logMetric(
    eventName: string,
    properties: Record<string, any>,
    callback: () => void,
  ): void
  function logMetric(eventName: string, callback: () => void): void
  function logMetric(eventName: string, properties?: Record<string, any>): void
  function logMetric(eventName: string): void

  function getVersionNumber(callback: (version: string) => void): void

  function getBrowserosVersionNumber(callback: (version: string) => void): void

  type SelectionType = 'file' | 'folder'

  interface ChoosePathOptions {
    type?: SelectionType
    title?: string
    startingDirectory?: string
  }

  interface SelectedPath {
    path: string
    name: string
  }

  function choosePath(
    options: ChoosePathOptions,
    callback: (result: SelectedPath | null) => void,
  ): void
  function choosePath(callback: (result: SelectedPath | null) => void): void
}
