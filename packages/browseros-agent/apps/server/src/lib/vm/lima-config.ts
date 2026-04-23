/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Arch } from './paths'

export interface LimaConfigInput {
  arch: Arch
  diskPath: string
  cpus: number
  memory: string
  disk: string
  vmStateDir: string
  imageCacheDir: string
  socketHostPath: string
}

export function generateLimaYaml(cfg: LimaConfigInput): string {
  const arch = cfg.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return [
    'vmType: "vz"',
    'rosetta:',
    '  enabled: false',
    `arch: "${arch}"`,
    `cpus: ${cfg.cpus}`,
    `memory: "${cfg.memory}"`,
    `disk: "${cfg.disk}"`,
    'images:',
    `  - location: "${cfg.diskPath}"`,
    `    arch: "${arch}"`,
    'mounts:',
    `  - location: "${cfg.vmStateDir}"`,
    '    mountPoint: "/mnt/browseros/vm"',
    '    writable: true',
    `  - location: "${cfg.imageCacheDir}"`,
    '    mountPoint: "/mnt/browseros/cache/images"',
    '    writable: false',
    'containerd:',
    '  system: false',
    '  user: true',
    'portForwards:',
    '  - guestSocket: "/run/user/{{.UID}}/containerd-rootless/containerd.sock"',
    `    hostSocket: "${cfg.socketHostPath}"`,
    'user:',
    '  name: "browseros"',
    '',
  ].join('\n')
}

export function renderLimaTemplate(
  template: string,
  cfg: {
    vmStateDir: string
    imageCacheDir: string
  },
): string {
  const mounts = [
    'mounts:',
    `- location: "${cfg.vmStateDir}"`,
    '  mountPoint: "/mnt/browseros/vm"',
    '  writable: true',
    `- location: "${cfg.imageCacheDir}"`,
    '  mountPoint: "/mnt/browseros/cache/images"',
    '  writable: false',
  ].join('\n')

  if (!template.includes('mounts: []')) {
    throw new Error('BrowserOS VM Lima template is missing mounts: [] marker')
  }

  return template.replace('mounts: []', mounts)
}
