import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { ARCHES, type ContainerArch } from './schema/arch'

export const agentEntrySchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  image: z.string().min(1),
  version: z.string().min(1),
  arches: z.array(z.enum(ARCHES)).min(1),
  publishAs: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  requires_auth: z
    .object({
      secret: z.string().min(1),
      username: z.string().min(1).optional(),
    })
    .optional(),
})

export const agentsConfigSchema = z
  .object({
    schema: z.literal('v1'),
    agents: z.array(agentEntrySchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>()
    for (const [index, agent] of config.agents.entries()) {
      if (seen.has(agent.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['agents', index, 'name'],
          message: `duplicate agent name: ${agent.name}`,
        })
      }
      seen.add(agent.name)
    }
  })

export type AgentEntry = z.infer<typeof agentEntrySchema>
export type AgentsConfig = z.infer<typeof agentsConfigSchema>

export interface MatrixEntry {
  agent: string
  image: string
  version: string
  arch: ContainerArch
  publishAs: string
}

export function publishNameForAgent(agent: AgentEntry): string {
  return agent.publishAs ?? agent.name
}

export async function readAgentsConfig(path: string): Promise<AgentsConfig> {
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  return agentsConfigSchema.parse(parsed)
}

export function expandMatrix(
  config: AgentsConfig,
  filter: { agent?: string } = {},
): MatrixEntry[] {
  const entries: MatrixEntry[] = []

  for (const agent of config.agents) {
    if (filter.agent && agent.name !== filter.agent) {
      continue
    }

    for (const arch of agent.arches) {
      entries.push({
        agent: agent.name,
        image: agent.image,
        version: agent.version,
        arch,
        publishAs: publishNameForAgent(agent),
      })
    }
  }

  return entries.sort((left, right) => {
    const byAgent = left.agent.localeCompare(right.agent)
    if (byAgent !== 0) {
      return byAgent
    }

    return left.arch.localeCompare(right.arch)
  })
}
