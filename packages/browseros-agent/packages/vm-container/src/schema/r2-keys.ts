import type { Arch } from './arch'

export const R2_VM_PREFIX = 'vm'

export const qcowFilename = (version: string, arch: Arch): string =>
  `browseros-vm-${version}-${arch}.qcow2.zst`

export const keyForQcow = (version: string, arch: Arch): string =>
  `${R2_VM_PREFIX}/${version}/${qcowFilename(version, arch)}`

export const keyForSha = (version: string, arch: Arch): string =>
  `${keyForQcow(version, arch)}.sha256`

export const keyForManifest = (version: string): string =>
  `${R2_VM_PREFIX}/${version}/manifest.json`

export const keyForLatest = (): string => `${R2_VM_PREFIX}/latest.json`
