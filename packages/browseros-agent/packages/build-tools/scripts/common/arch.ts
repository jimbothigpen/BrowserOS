export type Arch = 'arm64' | 'x64'

export const ARCHES: readonly Arch[] = ['arm64', 'x64']

export function parseArch(raw: string): Arch {
  if (raw === 'arm64' || raw === 'x64') return raw
  throw new Error(`unknown arch: ${raw} (expected arm64|x64)`)
}

export function podmanArch(arch: Arch): 'arm64' | 'amd64' {
  return arch === 'x64' ? 'amd64' : 'arm64'
}
