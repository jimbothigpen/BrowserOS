export class OpenClawInvalidAgentNameError extends Error {
  constructor() {
    super(
      'Agent name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
    )
    this.name = 'OpenClawInvalidAgentNameError'
  }
}

export class OpenClawAgentAlreadyExistsError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" already exists`)
    this.name = 'OpenClawAgentAlreadyExistsError'
  }
}

export class OpenClawAgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" not found`)
    this.name = 'OpenClawAgentNotFoundError'
  }
}

export class OpenClawInvalidAgentModelError extends Error {
  constructor() {
    super('A provider-backed model selection is required to update an agent')
    this.name = 'OpenClawInvalidAgentModelError'
  }
}

export class OpenClawProtectedAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenClawProtectedAgentError'
  }
}
