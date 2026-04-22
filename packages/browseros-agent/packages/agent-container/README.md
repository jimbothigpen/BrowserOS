# @browseros/agent-container

OCI tarball producer for BrowserOS-bundled agent containers.

This package owns the WS2 pipeline:

- Read the active agent set from `recipe/agents.json`
- Pull the upstream image with `podman`
- Save it as an OCI archive and gzip it
- Smoke-test the archive with `podman load`
- Publish tarballs, checksum sidecars, and manifests to R2

Package env requirements are documented in [.env.sample](./.env.sample).

## Local usage

```bash
cd packages/browseros-agent

# Print the GitHub Actions matrix JSON
bun run --filter @browseros/agent-container list-matrix

# Build one artifact locally
bun run --filter @browseros/agent-container build -- \
  --agent openclaw \
  --arch arm64 \
  --output-dir dist/agent-container/openclaw/arm64

# Smoke-test a built tarball
bun run --filter @browseros/agent-container smoke -- \
  --tarball dist/agent-container/openclaw/arm64/openclaw-2026.4.12-arm64.tar.gz \
  --expected-image ghcr.io/openclaw/openclaw:2026.4.12 \
  --expected-fingerprint ...

# Upload pre-built artifacts
# Fill these from packages/agent-container/.env.sample
R2_ACCOUNT_ID=... \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=... \
bun run --filter @browseros/agent-container upload -- \
  --artifact-dir dist/agent-container \
  --update-aggregate
```

## Notes

- `recipe/agents.json` is the source of truth for the active set.
- `workflow_dispatch` version overrides are intended for dry runs. Publishing still needs the recipe to be authoritative.
- `src/load.ts` is intentionally stubbed. WS6 fills in the runtime consumer path.
- Private registry auth is recipe-driven: if `requires_auth.secret` is set for an agent, export that env var before running `build`.
