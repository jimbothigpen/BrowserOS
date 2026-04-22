# @browseros/build-tools

Builds BrowserOS VM disks and agent image tarballs, publishes release artifacts to R2, and hydrates the local VM artifact cache for development.

## Setup

```bash
cp packages/build-tools/.env.sample packages/build-tools/.env
bun install
```

## Build a VM disk

Requires `libguestfs`, `qemu-img`, and `zstd` in an arm64 Linux environment.
On Apple Silicon, run this from an arm64 Lima/Debian VM rather than directly on macOS.

```bash
bun run --filter @browseros/build-tools build:disk -- --version 2026.04.22 --arch arm64
```

## Build an agent tarball

Requires `podman`.

```bash
bun run --filter @browseros/build-tools build:tarball -- --agent openclaw --arch arm64
```

## Smoke test artifacts

VM smoke tests require `limactl`, `qemu`, and `zstd`. Agent tarball smoke tests require `podman`.

```bash
bun run --filter @browseros/build-tools smoke:vm -- --arch arm64 --qcow ./dist/browseros-vm-2026.04.22-arm64.qcow2.zst
bun run --filter @browseros/build-tools smoke:tarball -- --agent openclaw --arch arm64 --tarball ./dist/images/openclaw-2026.4.12-arm64.tar.gz
```

## Emit a manifest

```bash
bun run --filter @browseros/build-tools emit-manifest -- --dist-dir packages/build-tools/dist
```

Publish workflows can update only one manifest slice at a time. Sliced publishing requires an existing R2 `vm/manifest.json` baseline; bootstrap first releases with `--slice full`.

```bash
bun run --filter @browseros/build-tools emit-manifest -- --slice vm --merge-from https://cdn.browseros.com/vm/manifest.json
bun run --filter @browseros/build-tools emit-manifest -- --slice agents:openclaw --merge-from https://cdn.browseros.com/vm/manifest.json
```

## Sync the dev cache

```bash
NODE_ENV=development bun run --filter @browseros/build-tools cache:sync
```

Development cache files land under `~/.browseros-dev/cache/vm/`. Production-mode cache files land under `~/.browseros/cache/vm/`.
