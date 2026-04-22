import path from 'node:path'

export type RecipeOp =
  | { op: 'run-command'; cmd: string }
  | { op: 'copy-in'; src: string; dest: string }
  | { op: 'write'; dest: string; content: string }
  | { op: 'truncate'; target: string }

export function parseRecipe(text: string): RecipeOp[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseLine)
}

function parseLine(line: string): RecipeOp {
  const space = line.indexOf(' ')
  if (space === -1) {
    throw new Error(`recipe line missing argument: ${line}`)
  }
  const op = line.slice(0, space)
  const arg = line.slice(space + 1).trim()
  switch (op) {
    case 'run-command':
      return { op, cmd: arg }
    case 'copy-in': {
      const colon = arg.indexOf(':')
      if (colon === -1) throw new Error(`copy-in missing ':': ${line}`)
      return { op, src: arg.slice(0, colon), dest: arg.slice(colon + 1) }
    }
    case 'write': {
      const colon = arg.indexOf(':')
      if (colon === -1) throw new Error(`write missing ':': ${line}`)
      return { op, dest: arg.slice(0, colon), content: arg.slice(colon + 1) }
    }
    case 'truncate':
      return { op, target: arg }
    default:
      throw new Error(`unknown recipe op: ${op}`)
  }
}

export interface ComposeOptions {
  diskPath: string
  recipe: RecipeOp[]
  substitutions: Record<string, string>
  recipeDir: string
}

export function composeVirtCustomizeArgv(opts: ComposeOptions): string[] {
  const substitute = (s: string): string =>
    s.replaceAll(/\{(\w+)\}/g, (match, key) => opts.substitutions[key] ?? match)
  const argv = ['-a', opts.diskPath]
  for (const op of opts.recipe) {
    switch (op.op) {
      case 'run-command':
        argv.push('--run-command', substitute(op.cmd))
        break
      case 'copy-in': {
        const resolvedSrc = op.src.startsWith('/')
          ? substitute(op.src)
          : path.join(opts.recipeDir, substitute(op.src))
        argv.push('--copy-in', `${resolvedSrc}:${op.dest}`)
        break
      }
      case 'write':
        argv.push('--write', `${op.dest}:${substitute(op.content)}`)
        break
      case 'truncate':
        argv.push('--truncate', op.target)
        break
    }
  }
  argv.push(
    '--run-command',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg format placeholder, not JS template
    "dpkg-query -W -f='${Package} ${Version}\\n' > /var/lib/browseros-vm-pkg-versions",
  )
  return argv
}

export function parsePackagesOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const space = trimmed.indexOf(' ')
    if (space === -1) continue
    out[trimmed.slice(0, space)] = trimmed.slice(space + 1)
  }
  return out
}
