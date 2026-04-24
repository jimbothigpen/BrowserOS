#!/usr/bin/env bun
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parseArch, podmanArch } from './common/arch'
import { type Bundle, tarballKey } from './common/manifest'
import { sha256File } from './common/sha256'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: { type: 'string' },
    arch: { type: 'string' },
    'output-dir': { type: 'string', default: './dist/images' },
  },
})

if (!values.agent || !values.arch) {
  console.error(
    'usage: build:tarball -- --agent <name> --arch <arm64|x64> [--output-dir ./dist/images]',
  )
  process.exit(1)
}

const arch = parseArch(values.arch)
const outDir = values['output-dir']
await mkdir(outDir, { recursive: true })

const pkgRoot = path.resolve(import.meta.dir, '..')
const bundle = JSON.parse(
  await readFile(path.join(pkgRoot, 'bundle.json'), 'utf8'),
) as Bundle
const agent = bundle.agents.find(({ name }) => name === values.agent)
if (!agent) throw new Error(`unknown agent: ${values.agent}`)

const ref = `${agent.image}:${agent.version}`
const tarballPath = path.join(
  outDir,
  path.basename(tarballKey(agent.name, agent.version, arch)),
)
const tarPath = tarballPath.slice(0, -'.gz'.length)

await rm(tarballPath, { force: true })
await rm(`${tarballPath}.sha256`, { force: true })
await rm(tarPath, { force: true })
await spawnChecked([
  'podman',
  'pull',
  '--os',
  'linux',
  '--arch',
  podmanArch(arch),
  ref,
])
await spawnChecked([
  'podman',
  'save',
  '--format=oci-archive',
  '--output',
  tarPath,
  ref,
])
await spawnChecked(['gzip', '-9', '-f', tarPath])

const sha = await sha256File(tarballPath)
const size = (await stat(tarballPath)).size
await writeFile(
  `${tarballPath}.sha256`,
  `${sha}  ${path.basename(tarballPath)}\n`,
)

console.log(
  JSON.stringify(
    {
      key: tarballKey(agent.name, agent.version, arch),
      path: tarballPath,
      sha256: sha,
      sizeBytes: size,
    },
    null,
    2,
  ),
)

async function spawnChecked(argv: string[]): Promise<void> {
  const proc = Bun.spawn(argv, {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${argv[0]} exited ${code}`)
}
