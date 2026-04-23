/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import {
  generateLimaYaml,
  renderLimaTemplate,
} from '../../../src/lib/vm/lima-config'

describe('generateLimaYaml', () => {
  it('generates the BrowserOS Lima VM config for arm64', () => {
    const yaml = generateLimaYaml({
      arch: 'arm64',
      diskPath: '/cache/browseros-vm.qcow2',
      cpus: 2,
      memory: '2GiB',
      disk: '10GiB',
      vmStateDir: '/Users/me/.browseros/vm',
      imageCacheDir: '/Users/me/.browseros/cache/vm/images',
      socketHostPath:
        '/Users/me/.browseros/lima/browseros-vm/sock/containerd.sock',
    })

    expect(yaml).toContain('vmType: "vz"')
    expect(yaml).toContain('arch: "aarch64"')
    expect(yaml).toContain('location: "/cache/browseros-vm.qcow2"')
    expect(yaml).toContain('mountPoint: "/mnt/browseros/vm"')
    expect(yaml).toContain('writable: true')
    expect(yaml).toContain('mountPoint: "/mnt/browseros/cache/images"')
    expect(yaml).toContain('writable: false')
    expect(yaml).toContain('containerd:')
    expect(yaml).toContain('system: false')
    expect(yaml).toContain('user: true')
    expect(yaml).toContain(
      'guestSocket: "/run/user/{{.UID}}/containerd-rootless/containerd.sock"',
    )
    expect(yaml).toContain(
      'hostSocket: "/Users/me/.browseros/lima/browseros-vm/sock/containerd.sock"',
    )
    expect(yaml).not.toContain('/var/run/containerd/containerd.sock')
    expect(yaml).toContain('name: "browseros"')
    expect(yaml).not.toContain('mountType: "9p"')
  })

  it('maps x64 to Lima x86_64', () => {
    const yaml = generateLimaYaml({
      arch: 'x64',
      diskPath: '/cache/browseros-vm.qcow2',
      cpus: 4,
      memory: '4GiB',
      disk: '20GiB',
      vmStateDir: '/Users/me/.browseros/vm',
      imageCacheDir: '/Users/me/.browseros/cache/vm/images',
      socketHostPath:
        '/Users/me/.browseros/lima/browseros-vm/sock/containerd.sock',
    })

    expect(yaml).toContain('arch: "x86_64"')
    expect(yaml).toContain('cpus: 4')
    expect(yaml).toContain('memory: "4GiB"')
    expect(yaml).toContain('disk: "20GiB"')
  })
})

describe('renderLimaTemplate', () => {
  it('injects BrowserOS host mounts into the bundled Lima template', () => {
    const yaml = renderLimaTemplate(
      'minimumLimaVersion: 2.0.0\nmounts: []\nprobes: []\n',
      {
        vmStateDir: '/Users/me/.browseros/vm',
        imageCacheDir: '/Users/me/.browseros/cache/vm/images',
      },
    )

    expect(yaml).toContain('mountPoint: "/mnt/browseros/vm"')
    expect(yaml).toContain('location: "/Users/me/.browseros/vm"')
    expect(yaml).toContain('mountPoint: "/mnt/browseros/cache/images"')
    expect(yaml).toContain('location: "/Users/me/.browseros/cache/vm/images"')
    expect(yaml).toContain('probes: []')
  })

  it('fails loudly if the template no longer has the expected mount marker', () => {
    expect(() =>
      renderLimaTemplate('minimumLimaVersion: 2.0.0\n', {
        vmStateDir: '/state',
        imageCacheDir: '/images',
      }),
    ).toThrow('mounts: [] marker')
  })
})
