package pipeline

func Build(agentRoot string, r Runner) error {
	if err := r.Run(agentRoot, "bun", "install", "--frozen-lockfile"); err != nil {
		return err
	}
	if err := r.Run(agentRoot, "bun", "run", "codegen:agent"); err != nil {
		return err
	}
	return r.Run(agentRoot, "bun", "--cwd", "apps/agent", "--env-file=.env.development", "wxt", "build", "--mode", "development")
}

type ExecRunner struct{}

func (ExecRunner) Run(dir string, args ...string) error {
	return runCommand(dir, args...)
}

func (ExecRunner) OutputRun(dir string, args ...string) (string, error) {
	return outputCommand(dir, args...)
}
