import type {
  AgentArtifact,
  AgentManifest,
  AggregateManifest,
  ContainerArch,
} from './schema'

export async function fetchAggregateManifest(): Promise<AggregateManifest> {
  throw new Error('fetchAggregateManifest: implemented in WS6')
}

export async function fetchAgentManifest(
  _agent: string,
  _version: string,
): Promise<AgentManifest> {
  throw new Error('fetchAgentManifest: implemented in WS6')
}

export async function verifySha256(
  _path: string,
  _expectedSha256: string,
): Promise<void> {
  throw new Error('verifySha256: implemented in WS6')
}

export async function findStagedTarball(
  _name: string,
  _version: string,
  _arch: ContainerArch,
): Promise<string> {
  throw new Error('findStagedTarball: implemented in WS6')
}

export async function loadTarball(
  _artifact: AgentArtifact,
  _destinationPath: string,
): Promise<void> {
  throw new Error('loadTarball: implemented in WS6')
}
