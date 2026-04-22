export const ARCHES = ['arm64', 'x64'] as const
export type Arch = (typeof ARCHES)[number]

export function parseArch(s: string): Arch {
  if (s === 'arm64' || s === 'x64') return s
  throw new Error(`invalid arch: ${s} (expected 'arm64' | 'x64')`)
}

export const CALVER_REGEX = /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/

export function assertCalver(version: string): void {
  if (!CALVER_REGEX.test(version)) {
    throw new Error(`invalid CalVer: ${version} (expected YYYY.MM.DD[-N])`)
  }
}
