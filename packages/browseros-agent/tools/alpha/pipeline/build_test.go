package pipeline

import "testing"

func TestBuildRunsExpectedCommands(t *testing.T) {
	root := t.TempDir()
	r := &FakeRunner{}
	if err := Build(root, r); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"bun install --frozen-lockfile",
		"bun run codegen:agent",
		"bun --cwd apps/agent --env-file=.env.development wxt build --mode development",
	}
	for i := range want {
		if r.Commands[i] != want[i] {
			t.Fatalf("command %d got %q want %q", i, r.Commands[i], want[i])
		}
	}
}
