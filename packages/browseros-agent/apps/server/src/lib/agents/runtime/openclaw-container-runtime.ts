/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  OPENCLAW_GATEWAY_CONTAINER_NAME,
  OPENCLAW_GATEWAY_CONTAINER_PORT,
  OPENCLAW_IMAGE,
} from '@browseros/shared/constants/openclaw'
import { getOpenClawStateEnvPath } from '../../../api/services/openclaw/openclaw-env'
import { getBrowserosDir, getOpenClawDir } from '../../browseros-dir'
import { ContainerCli } from '../../container/container-cli'
import { ImageLoader } from '../../container/image-loader'
import type {
  ContainerDescriptor,
  ManagedContainerDeps,
  MountRoot,
} from '../../container/managed'
import type { ContainerSpec, LogFn } from '../../container/types'
import { logger } from '../../logger'
import {
  GUEST_VM_STATE,
  getLimaHomeDir,
  resolveBundledLimactl,
  resolveBundledLimaTemplate,
  VM_NAME,
  VmRuntime,
} from '../../vm'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx-agent-adapter'
import {
  buildBrowserosAcpPrompt,
  ensureUsableCwd,
  resolveAgentRuntimePaths,
} from '../acpx-runtime-context'
import { ContainerAgentRuntime } from './container-agent-runtime'
import { getAgentRuntimeRegistry } from './registry'
import type { ExecSpec } from './types'

const GATEWAY_CONTAINER_HOME = '/home/node'
const GATEWAY_STATE_DIR = `${GATEWAY_CONTAINER_HOME}/.openclaw`
const GUEST_OPENCLAW_HOME = `${GUEST_VM_STATE}/openclaw`
const GATEWAY_NPM_PREFIX = `${GATEWAY_CONTAINER_HOME}/.npm-global`
const GATEWAY_PATH = [
  `${GATEWAY_NPM_PREFIX}/bin`,
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
].join(':')

const OPENCLAW_BROWSEROS_ACP_INSTRUCTIONS =
  '<role>You are running inside BrowserOS through the OpenClaw ACP adapter. Use your OpenClaw identity, memory, and browser tools.</role>'

export interface OpenClawContainerRuntimeConfig {
  /** BrowserOS state root. */
  browserosDir: string
  /** OpenClaw state dir (`<browserosDir>/vm/openclaw`). */
  openclawDir: string
}

export class OpenClawContainerRuntime extends ContainerAgentRuntime {
  readonly descriptor: ContainerDescriptor & { kind: 'container' } = {
    adapterId: 'openclaw',
    displayName: 'OpenClaw',
    kind: 'container',
    defaultImage: process.env.OPENCLAW_IMAGE?.trim() || OPENCLAW_IMAGE,
    containerName: OPENCLAW_GATEWAY_CONTAINER_NAME,
    platforms: ['darwin'],
    readinessProbe: { timeoutMs: 60_000, intervalMs: 1_000 },
  }

  private readonly openclawConfig: OpenClawContainerRuntimeConfig
  private hostPort: number = OPENCLAW_GATEWAY_CONTAINER_PORT

  constructor(
    deps: ManagedContainerDeps,
    config: OpenClawContainerRuntimeConfig,
  ) {
    super(deps)
    this.openclawConfig = config
  }

  /** Service owns port allocation; the runtime re-reads it at spec-build and probe time. */
  setHostPort(port: number): void {
    this.hostPort = port
  }

  getHostPort(): number {
    return this.hostPort
  }

  // ── ManagedContainer abstracts ───────────────────────────────────

  protected mountRoots(): readonly MountRoot[] {
    return [
      {
        hostPath: this.openclawConfig.openclawDir,
        containerPath: GATEWAY_CONTAINER_HOME,
        kind: 'shared',
      },
    ]
  }

  protected async buildContainerSpec(): Promise<ContainerSpec> {
    const hostPort = this.hostPort
    const envFilePath = getOpenClawStateEnvPath(this.openclawConfig.openclawDir)
    // OpenClawService normally seeds this during its setup flow, but
    // starting via the runtime directly (RuntimeControlPanel "Start"
    // CTA on a fresh install) bypasses that path, so nerdctl --env-file
    // would crash on the missing file. Touch it here so the runtime is
    // self-sufficient.
    if (!existsSync(envFilePath)) {
      await mkdir(dirname(envFilePath), { recursive: true })
      await writeFile(envFilePath, '', { mode: 0o600 })
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const gateway = await this.deps.vm.getDefaultGateway()
    return {
      name: OPENCLAW_GATEWAY_CONTAINER_NAME,
      image: this.descriptor.defaultImage,
      restart: 'unless-stopped',
      ports: [
        {
          hostIp: '127.0.0.1',
          hostPort,
          containerPort: OPENCLAW_GATEWAY_CONTAINER_PORT,
        },
      ],
      envFile: this.translateHostPathToGuest(envFilePath),
      env: this.buildGatewayEnv(timezone),
      mounts: [{ source: GUEST_OPENCLAW_HOME, target: GATEWAY_CONTAINER_HOME }],
      addHosts: [`host.containers.internal:${gateway}`],
      health: {
        cmd: `curl -sf http://127.0.0.1:${OPENCLAW_GATEWAY_CONTAINER_PORT}/healthz`,
        interval: '30s',
        timeout: '10s',
        retries: 3,
      },
      command: [
        'node',
        'dist/index.js',
        'gateway',
        '--bind',
        'lan',
        '--port',
        String(OPENCLAW_GATEWAY_CONTAINER_PORT),
        '--allow-unconfigured',
      ],
    }
  }

  protected async readinessProbe(): Promise<boolean> {
    const hostPort = this.hostPort
    try {
      const res = await fetch(`http://127.0.0.1:${hostPort}/readyz`)
      return res.ok
    } catch {
      return false
    }
  }

  // ── AgentRuntime additions ───────────────────────────────────────

  getPerAgentHomeDir(_agentId: string): string {
    return this.openclawConfig.openclawDir
  }

  /** Build the ExecSpec for `openclaw acp` inside the gateway container. */
  getAcpExecSpec(input: {
    commandEnv: Record<string, string>
    openclawSessionKey: string | null
  }): ExecSpec {
    const argv: [string, ...string[]] = ['openclaw', 'acp']
    argv.push('--url', `ws://127.0.0.1:${OPENCLAW_GATEWAY_CONTAINER_PORT}`)
    const bridgeSessionKey = normalizeBridgeSessionKey(input.openclawSessionKey)
    if (bridgeSessionKey) argv.push('--session', bridgeSessionKey)
    return {
      argv,
      env: {
        OPENCLAW_HIDE_BANNER: '1',
        OPENCLAW_SUPPRESS_NOTES: '1',
        ...input.commandEnv,
      },
    }
  }

  prepareTurnContext(
    input: PrepareAcpxAgentContextInput,
  ): Promise<PreparedAcpxAgentContext> {
    return prepareOpenClawContext(input)
  }

  // ── OpenClaw-specific surface kept on the runtime ────────────────

  /** Run argv in the gateway container; satisfies OpenClawCliClient's ContainerExecutor. */
  async execInContainer(command: string[], onLog?: LogFn): Promise<number> {
    return this.deps.cli.exec(this.descriptor.containerName, command, onLog)
  }

  /** Run argv in the gateway container with stdout + stderr captured separately. */
  async runInContainer(
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.deps.cli.runCommand([
      'exec',
      this.descriptor.containerName,
      ...command,
    ])
  }

  /** Standalone VM-ready entry point used by prewarm / auto-start gating. */
  async ensureReady(onLog?: LogFn): Promise<void> {
    await this.deps.vm.ensureReady(onLog)
    await this.deps.vm.getDefaultGateway()
  }

  async stopVm(): Promise<void> {
    await this.deps.vm.stopVm()
  }

  async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    const running = await this.deps.vm.isReady()
    return { initialized: running, running }
  }

  isHealthy(): Promise<boolean> {
    const hostPort = this.hostPort
    return fetchOk(`http://127.0.0.1:${hostPort}/healthz`)
  }

  /** Public proxy for the readiness probe so callers don't need to
   *  reach into the protected method. */
  isReady(): Promise<boolean> {
    return this.readinessProbe()
  }

  /** Sync internal state from the actual container — used at boot
   *  when the gateway may already be running from a previous server
   *  process and the runtime's state machine starts fresh. Also
   *  reconciles `hostPort` against the live port mapping when the
   *  persisted runtime-state.json drifted from what the container
   *  was actually started with. */
  async syncState(): Promise<void> {
    try {
      const info = await this.deps.cli.inspectContainer(
        this.descriptor.containerName,
      )
      if (!info) {
        if (this.state !== 'not_installed') this.setState('not_installed')
        return
      }
      if (info.running) {
        const mapped = info.ports.find(
          (p) =>
            p.containerPort === OPENCLAW_GATEWAY_CONTAINER_PORT &&
            p.protocol === 'tcp',
        )
        if (mapped && mapped.hostPort !== this.hostPort) {
          logger.info('OpenClaw runtime host port reconciled from container', {
            previous: this.hostPort,
            actual: mapped.hostPort,
          })
          this.hostPort = mapped.hostPort
        }
        if (await fetchOk(`http://127.0.0.1:${this.hostPort}/readyz`)) {
          this.setState('running')
          return
        }
        this.setState('starting')
        return
      }
      this.setState('stopped')
    } catch (err) {
      logger.warn('OpenClaw runtime syncState failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Service-facing compat surface ────────────────────────────────
  // These wrap inherited lifecycle methods using the legacy method
  // names OpenClawService still uses. Keeping them lets the service
  // swap from the legacy `ContainerRuntime` to this class with
  // minimal touch; a follow-up can rename the call sites to use
  // `executeAction(...)` directly and drop these wrappers.

  /** Pre-pull the gateway image without starting the container. */
  async prewarmGatewayImage(onLog?: LogFn): Promise<void> {
    await this.executeAction({ type: 'install' }, { onLog })
  }

  /** Start the gateway container with the runtime's own spec. */
  async startGateway(_unused?: unknown, onLog?: LogFn): Promise<void> {
    await this.executeAction({ type: 'start' }, { onLog })
  }

  async stopGateway(): Promise<void> {
    await this.executeAction({ type: 'stop' })
  }

  async restartGateway(_unused?: unknown, onLog?: LogFn): Promise<void> {
    await this.executeAction({ type: 'restart' }, { onLog })
  }

  /** Poll readiness until ready or timeout. Returns whether ready. */
  async waitForReady(_hostPort?: number, timeoutMs = 30_000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.readinessProbe()) return true
      await Bun.sleep(1000)
    }
    return false
  }

  async getGatewayLogs(tail = 50): Promise<string[]> {
    return this.getLogs(tail)
  }

  tailGatewayLogs(onLine: LogFn): () => void {
    return this.tailLogs(onLine)
  }

  isGatewayCurrent(): Promise<boolean> {
    return this.isImageCurrent()
  }

  /** Run a one-shot command in a `<name>-setup` sibling container. */
  async runGatewaySetupCommand(
    command: string[],
    _unused?: unknown,
    onLog?: LogFn,
  ): Promise<number> {
    const argv = command[0] === 'node' ? command.slice(1) : command
    const result = await this.runOneShot(['node', ...argv], { onLog })
    return result.exitCode
  }

  // ── Internals ────────────────────────────────────────────────────

  private buildGatewayEnv(timezone: string): Record<string, string> {
    return {
      HOME: GATEWAY_CONTAINER_HOME,
      OPENCLAW_HOME: GATEWAY_CONTAINER_HOME,
      OPENCLAW_STATE_DIR: GATEWAY_STATE_DIR,
      OPENCLAW_NO_RESPAWN: '1',
      NODE_COMPILE_CACHE: '/var/tmp/openclaw-compile-cache',
      NODE_ENV: 'production',
      TZ: timezone,
      PATH: GATEWAY_PATH,
      NPM_CONFIG_PREFIX: GATEWAY_NPM_PREFIX,
      OPENCLAW_GATEWAY_PRIVATE_INGRESS_NO_AUTH: '1',
    }
  }

  private translateHostPathToGuest(hostPath: string): string {
    const root = this.openclawConfig.openclawDir
    if (hostPath === root) return GUEST_OPENCLAW_HOME
    if (hostPath.startsWith(`${root}/`)) {
      return `${GUEST_OPENCLAW_HOME}${hostPath.slice(root.length)}`
    }
    // Fall back to the generic VM path translation. acpx-side callers
    // never pass paths outside openclawDir today, but the legacy
    // implementation tolerated it so we mirror the behaviour.
    return hostPath
  }
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

/** Normalize an acpx session key into the form OpenClaw expects on
 *  `--session`: must start with `agent:` and be alphanumeric/dash. */
function normalizeBridgeSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey) return null
  if (sessionKey.startsWith('agent:')) return sessionKey
  return `agent:main:${sessionKey.replace(/[^a-zA-Z0-9-]/g, '-')}`
}

/** Prepare OpenClaw without BrowserOS SOUL/MEMORY or BrowserOS MCP. */
export async function prepareOpenClawContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const paths = resolveAgentRuntimePaths({
    browserosDir: input.browserosDir,
    agentId: input.agent.id,
  })
  await ensureUsableCwd(paths.effectiveCwd, true)
  return {
    cwd: paths.effectiveCwd,
    runtimeSessionKey: input.sessionKey,
    runPrompt: buildBrowserosAcpPrompt(
      OPENCLAW_BROWSEROS_ACP_INSTRUCTIONS,
      input.message,
    ),
    commandEnv: {},
    commandIdentity: 'openclaw',
    useBrowserosMcp: false,
    openclawSessionKey: input.sessionKey,
  }
}

// ── Factory + wire-up ──────────────────────────────────────────────

export interface ConfigureOpenClawRuntimeOptions {
  resourcesDir?: string
  browserosDir?: string
}

/** Build an OpenClawContainerRuntime with production deps and register
 *  it. Idempotent — repeat calls return the already-registered runtime.
 *  Constructs on every platform so service callers (and tests that
 *  override `service.runtime` post-construction) work uniformly. The
 *  descriptor's `platforms: ['darwin']` is the live signal for the UI
 *  / adapter health, and `start()` itself fails at limactl-not-found
 *  on non-darwin if anyone actually invokes it. */
export function configureOpenClawRuntime(
  options: ConfigureOpenClawRuntimeOptions = {},
): OpenClawContainerRuntime {
  const existing = getOpenClawRuntime()
  if (existing) return existing

  const browserosDir = options.browserosDir ?? getBrowserosDir()
  const openclawDir = getOpenClawDir()
  const resourcesDir = options.resourcesDir ?? null
  // Resolve bundled paths optimistically — on platforms / CI runners
  // without Lima, fall back to the bare command names so construction
  // succeeds. Lifecycle ops will fail at spawn time with the same
  // "not on PATH" error, matching how the other runtimes degrade.
  const limactlPath = (() => {
    if (!resourcesDir) return 'limactl'
    try {
      return resolveBundledLimactl(resourcesDir)
    } catch (err) {
      logger.warn('OpenClaw bundled limactl unavailable; falling back', {
        error: err instanceof Error ? err.message : String(err),
      })
      return 'limactl'
    }
  })()
  const templatePath = (() => {
    if (!resourcesDir) return undefined
    try {
      return resolveBundledLimaTemplate(resourcesDir)
    } catch {
      return undefined
    }
  })()
  const limaHome = getLimaHomeDir(browserosDir)

  const vm = new VmRuntime({
    limactlPath,
    limaHome,
    templatePath,
    browserosRoot: browserosDir,
  })
  const cli = new ContainerCli({ limactlPath, limaHome, vmName: VM_NAME })
  const loader = new ImageLoader(cli)

  const runtime = new OpenClawContainerRuntime(
    {
      cli,
      loader,
      vm,
      limactlPath,
      limaHome,
      vmName: VM_NAME,
      lockDir: join(openclawDir, '.locks'),
    },
    { browserosDir, openclawDir },
  )

  getAgentRuntimeRegistry().register(runtime)
  logger.debug('OpenClawContainerRuntime registered', {
    image: runtime.descriptor.defaultImage,
  })
  return runtime
}

export function getOpenClawRuntime(): OpenClawContainerRuntime | null {
  const r = getAgentRuntimeRegistry().get('openclaw')
  return r instanceof OpenClawContainerRuntime ? r : null
}
