# @browseros/vm-container

Produces the Debian + Podman `qcow2` disk image shipped inside BrowserOS. This
is the WS1 deliverable from `specs/bundled-vm-runtime-spec.md`.

The package owns three surfaces:

- **Build** (`bun run build`) — runs `virt-customize` against a pinned Debian
  genericcloud image and emits a `.qcow2.zst` plus a `build-result-<arch>.json`
  metadata file.
- **Upload** (`bun run upload`) — publishes pre-built artifacts to R2 under
  `vm/<version>/` with a per-version `manifest.json` and a top-level
  `latest.json` pointer.
- **Smoke** (`bun run smoke`) — boots a built `.qcow2.zst` in Lima + QEMU and
  pings `podman.socket`.

Types under `@browseros/vm-container/schema` are the consumer contract. WS4's
runtime code imports `VmManifest`, `parseManifest`, and the R2 key helpers so
producer and consumer can't drift.

## Requirements

- **Linux host** (libguestfs / `virt-customize` is Linux-only).
- `libguestfs-tools`, `qemu-utils`, `zstd` on `PATH` (`sudo apt-get install …`
  on Debian/Ubuntu).
- Bun `^1.3.6`. Run from the monorepo root once with `bun install`.

On macOS, the build step does not run locally — use the GitHub Actions
workflow (`build-vm-container.yml`) or a Linux VM.

## Environment

The upload step needs Cloudflare R2 credentials. Locally put them in `.env`
inside this directory (`.env` is gitignored by the root rule). For CI, the
workflow sets them from repo secrets — no `.env` file needed.

| Variable                | Required | Default                     | Notes                                      |
| ----------------------- | -------- | --------------------------- | ------------------------------------------ |
| `R2_ACCOUNT_ID`         | upload   | —                           |                                            |
| `R2_ACCESS_KEY_ID`      | upload   | —                           |                                            |
| `R2_SECRET_ACCESS_KEY`  | upload   | —                           |                                            |
| `R2_BUCKET`             | upload   | —                           | e.g. `browseros`                           |
| `CDN_BASE_URL`          | optional | `https://cdn.browseros.com` | Only affects URLs written into `manifest.json`. |

If you already have R2 credentials in another repo `.env`, symlink it to avoid
duplicating secrets:

```bash
cd packages/browseros-agent/packages/vm-container
ln -s ../../../browseros/.env .env        # Chromium build's .env
# or
ln -s ../../apps/server/.env.production .env
```

## Local build (Linux host)

```bash
cd packages/browseros-agent/packages/vm-container

# Build one arch. virt-customize inherits LIBGUESTFS_BACKEND from the shell.
LIBGUESTFS_BACKEND=direct bun run build -- \
  --version 2026.04.22-dev1 \
  --arch x64 \
  --output-dir ./dist/x64

# Smoke test the result (limactl on PATH required).
bun run smoke -- --qcow ./dist/x64/browseros-vm-2026.04.22-dev1-x64.qcow2.zst

# Upload both arches to R2 (requires R2_* env vars).
bun run upload -- --version 2026.04.22-dev1 --artifact-dir ./dist
```

`--update-latest` is the default on upload; pass `--no-update-latest` to keep
`vm/latest.json` pointing at whatever was there before.

## R2 layout produced

```
r2://$R2_BUCKET/vm/<version>/
  browseros-vm-<version>-arm64.qcow2.zst
  browseros-vm-<version>-arm64.qcow2.zst.sha256
  browseros-vm-<version>-x64.qcow2.zst
  browseros-vm-<version>-x64.qcow2.zst.sha256
  manifest.json
r2://$R2_BUCKET/vm/latest.json
```

`manifest.json` is the consumer contract — see `src/schema/manifest.ts` for
the zod schema. `latest.json` is a human/debug pointer and is **not**
consumed by `build:server`; WS3's follow-up pins a specific version in
`server-prod-resources.json`.

## CI

The `build-vm-container.yml` workflow runs:

1. Matrix build per arch on `ubuntu-24.04` + `ubuntu-24.04-arm64`.
2. x64 Lima boot smoke test.
3. Gated publish job (runs only on `workflow_dispatch` with `publish=true`).

Triggers: `workflow_dispatch` (manual), `pull_request` on
`packages/vm-container/**` (dry-run, no publish), and a weekly cron to catch
upstream Debian drift.

## Repro + pinning

- Base Debian image is pinned by sha256 in `src/build/base-image.ts`. Update
  the pin (and the upstream version) together when bumping to a newer daily.
- Recipe file (`recipe/browseros-vm.recipe`) is git-tracked and its sha256
  lands in `manifest.build.recipe_sha256`.
- Installed package versions are captured post-install via `dpkg-query` and
  land in `manifest.packages`.
- `manifest.build.git_sha` / `built_by` record the invocation context.

## What lives here vs. what's elsewhere

- **Here:** disk recipe, build orchestrator, R2 uploader, smoke test, types
  consumed by the runtime.
- **Not here:** host-side consumption (`apps/server/.../podman-runtime.ts`),
  `server-prod-resources.json` entries, `limactl` binary upload (`packages/
  browseros/build/cli/storage.py`), agent container tarballs (WS2 lives in
  `packages/browseros-agent/packages/agent-container/` once it lands).
