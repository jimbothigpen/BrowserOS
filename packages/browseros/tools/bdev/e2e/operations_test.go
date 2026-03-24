package e2e

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

var bdevBinary string

func TestMain(m *testing.M) {
	root, err := os.MkdirTemp("", "bdev-bin-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(root)
	bdevBinary = filepath.Join(root, "bdev")
	cmd := exec.Command("go", "build", "-o", bdevBinary, ".")
	cmd.Dir = ".."
	if out, err := cmd.CombinedOutput(); err != nil {
		panic(string(out))
	}
	os.Exit(m.Run())
}

func TestApplyExportAndFeatureTag(t *testing.T) {
	env := setupScenario(t)
	runBdev(t, env, env.chromium, "init", "--patches-repo", env.repo, "--name", "ch1")
	runBdev(t, env, env.chromium, "apply", "--all", "--clean")
	assertFileContains(t, filepath.Join(env.chromium, env.path), "upstream-1")

	writeFile(t, filepath.Join(env.chromium, env.path), "upstream-2\nline2\n")
	runBdev(t, env, env.chromium, "export", "--path", env.path, "--tag-feature", "test-feature")

	assertFileContains(t, filepath.Join(env.repo, "chromium_patches", env.path), "upstream-2")
	assertFileContains(t, filepath.Join(env.repo, "build", "features.yaml"), "test-feature")
	assertFileContains(t, filepath.Join(env.repo, "build", "features.yaml"), env.path)
}

func TestHelpListsGroupedCommands(t *testing.T) {
	env := setupScenario(t)
	out := runBdev(t, env, env.chromium, "--help")
	for _, want := range []string{"Setup:", "Inspect:", "Workflows:", "Repair:", "init", "checkouts", "apply", "reset"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected help output to contain %q\n%s", want, out)
		}
	}
}

func TestRebaseReplaysLocalOverlay(t *testing.T) {
	env := setupScenario(t)
	runBdev(t, env, env.chromium, "init", "--patches-repo", env.repo, "--name", "ch1")
	runBdev(t, env, env.chromium, "apply", "--all", "--clean")

	writeFile(t, filepath.Join(env.chromium, env.path), "upstream-1\nlocal-change\n")

	updateRepoPatch(t, env.chromium, env.repo, env.baseCommit, env.path, "upstream-2\nline2\n")
	runBdev(t, env, env.chromium, "rebase")
	assertFileContains(t, filepath.Join(env.chromium, env.path), "upstream-2\nlocal-change\n")
}

type scenario struct {
	root       string
	repo       string
	chromium   string
	path       string
	baseCommit string
	xdg        string
}

func setupScenario(t *testing.T) scenario {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "browseros")
	chromium := filepath.Join(root, "chromium")
	path := filepath.ToSlash(filepath.Join("chrome", "app", "test.txt"))
	xdg := filepath.Join(root, "xdg")

	mkdir(t, filepath.Join(chromium, "chrome", "app"))
	mkdir(t, filepath.Join(chromium, "base"))
	runGit(t, chromium, "init")
	configRepo(t, chromium)
	writeFile(t, filepath.Join(chromium, path), "base\nline2\n")
	writeFile(t, filepath.Join(chromium, "base", ".keep"), "marker\n")
	runGit(t, chromium, "add", "-A")
	runGit(t, chromium, "commit", "-m", "base")
	baseCommit := strings.TrimSpace(runGit(t, chromium, "rev-parse", "HEAD"))

	runGit(t, root, "init", repo)
	configRepo(t, repo)
	writeFile(t, filepath.Join(repo, "BASE_COMMIT"), baseCommit+"\n")
	writeFile(t, filepath.Join(repo, "CHROMIUM_VERSION"), "MAJOR=146\nMINOR=0\nBUILD=7680\nPATCH=31\n")
	updateRepoPatch(t, chromium, repo, baseCommit, path, "upstream-1\nline2\n")

	return scenario{
		root:       root,
		repo:       repo,
		chromium:   chromium,
		path:       path,
		baseCommit: baseCommit,
		xdg:        xdg,
	}
}

func updateRepoPatch(t *testing.T, chromiumRepo, repo, baseCommit, relPath, content string) {
	t.Helper()
	tmp := filepath.Join(filepath.Dir(repo), "tmp-chromium")
	runGit(t, filepath.Dir(repo), "clone", "--quiet", chromiumRepo, tmp)
	configRepo(t, tmp)
	runGit(t, tmp, "checkout", "--quiet", baseCommit)
	writeFile(t, filepath.Join(tmp, relPath), content)
	diff := runGit(t, tmp, "diff", "--full-index", baseCommit, "--", relPath)
	if strings.TrimSpace(diff) == "" {
		t.Fatalf("expected diff for %s", relPath)
	}
	writeFile(t, filepath.Join(repo, "chromium_patches", relPath), diff)
	runGit(t, repo, "add", "-A")
	runGit(t, repo, "commit", "-m", "update patch")
	os.RemoveAll(tmp)
}

func runBdev(t *testing.T, env scenario, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command(bdevBinary, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "XDG_CONFIG_HOME="+env.xdg)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bdev %v failed: %v\n%s", args, err, string(out))
	}
	return string(out)
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
	}
	return string(out)
}

func configRepo(t *testing.T, dir string) {
	t.Helper()
	runGit(t, dir, "config", "user.email", "bdev@example.com")
	runGit(t, dir, "config", "user.name", "bdev")
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	mkdir(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}
}

func assertFileContains(t *testing.T, path, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !strings.Contains(string(data), want) {
		t.Fatalf("expected %s to contain %q\n%s", path, want, string(data))
	}
}
