import type { Arch } from '../schema/arch'
import type { VmManifest } from '../schema/manifest'

// WS4 landing pad. Typed signatures only — bodies implemented by WS4 where
// podman-runtime.ts consumes the shipped qcow2. Keeping the types here
// prevents WS4's implementation from drifting from the producer's schema.

export async function downloadManifest(
  _version: string | 'latest',
): Promise<VmManifest> {
  throw new Error('downloadManifest: implemented in WS4')
}

export async function downloadQcow(
  _manifest: VmManifest,
  _arch: Arch,
  _destPath: string,
): Promise<void> {
  throw new Error('downloadQcow: implemented in WS4')
}

export async function verifySha256(
  _path: string,
  _expected: string,
): Promise<void> {
  throw new Error('verifySha256: implemented in WS4')
}
