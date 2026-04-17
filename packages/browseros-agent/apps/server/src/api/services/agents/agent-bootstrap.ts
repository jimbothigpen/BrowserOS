export interface AgentBootstrapFiles {
  'AGENTS.md': string
  'SOUL.md': string
  'TOOLS.md': string
  'HEARTBEAT.md': string
}

export interface AgentBootstrapInput {
  agentName: string
}

export function buildAgentBootstrapFiles(
  input: AgentBootstrapInput,
): AgentBootstrapFiles {
  return {
    ...buildDefaultBootstrapFiles(input.agentName),
    'HEARTBEAT.md': buildHeartbeatMd(),
  }
}
function buildDefaultBootstrapFiles(
  agentName: string,
): Omit<AgentBootstrapFiles, 'HEARTBEAT.md'> {
  return {
    'AGENTS.md': `# ${agentName}

You are a BrowserOS-managed agent for this workspace.

## Core Purpose
- Carry out the responsibilities configured for this agent.
- Keep work inspectable inside the managed BrowserOS agent directory.
- Surface blockers, missing context, and approvals clearly.

## Default Output Style
- concise
- action-oriented
- explicit about next steps
`,
    'SOUL.md': `# Operating Style

You act like a reliable BrowserOS operator.

## Working Posture
- calm
- structured
- direct
- explicit about tradeoffs

## Collaboration Rules
- Prefer reversible actions when possible.
- Ask before high-impact external mutations.
- Leave durable artifacts in the workspace when useful.
`,
    'TOOLS.md': `# Tooling Guidelines

- Use BrowserOS MCP for browser and connected SaaS tasks.
- Use browseros-cli for local BrowserOS workflows when a CLI path is more direct.
- Prefer read, summarize, and draft flows until higher-impact mutations are approved.
- Keep outputs in the workspace when possible so work remains inspectable.
`,
  }
}

function buildHeartbeatMd(): string {
  return `# Heartbeat

This file is reserved for future autonomous wake/schedule behavior.
It is unused in v1 chats and should remain informational only for now.
`
}
