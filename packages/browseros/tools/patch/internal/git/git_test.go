package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

var fullIndexLine = regexp.MustCompile(`(?m)^index [0-9a-f]{40}\.\.[0-9a-f]{40}`)
var fullIndexAddLine = regexp.MustCompile(`(?m)^index 0{40}\.\.[0-9a-f]{40}`)

func TestDiffTextEmitsFullIndexRegardlessOfRepoConfig(t *testing.T) {
	ctx := context.Background()
	dir := initGitRepo(t)
	// Hostile per-checkout config that must not leak into tool output.
	runGit(t, dir, "config", "core.abbrev", "9")
	runGit(t, dir, "config", "diff.noprefix", "true")
	runGit(t, dir, "config", "diff.mnemonicPrefix", "true")
	runGit(t, dir, "config", "diff.algorithm", "histogram")
	runGit(t, dir, "config", "diff.context", "8")

	writeFile(t, filepath.Join(dir, "f.txt"), "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-m", "base")
	writeFile(t, filepath.Join(dir, "f.txt"), "one\ntwo\nthree\nfour\nCHANGED\nsix\nseven\neight\nnine\nten\n")

	diff, err := DiffText(ctx, dir, "HEAD")
	if err != nil {
		t.Fatalf("DiffText: %v", err)
	}
	if !fullIndexLine.MatchString(diff) {
		t.Fatalf("expected full 40-hex index line, got:\n%s", diff)
	}
	if !strings.Contains(diff, "--- a/f.txt") || !strings.Contains(diff, "+++ b/f.txt") {
		t.Fatalf("expected a/ b/ prefixes despite noprefix/mnemonicPrefix config, got:\n%s", diff)
	}
	if !strings.Contains(diff, "@@ -2,7 +2,7 @@") {
		t.Fatalf("expected default 3-line context despite diff.context=8, got:\n%s", diff)
	}
}

func TestDiffNoIndexEmitsFullIndexNewFile(t *testing.T) {
	ctx := context.Background()
	dir := initGitRepo(t)
	writeFile(t, filepath.Join(dir, "new.txt"), "hello\n")

	diff, err := DiffNoIndex(ctx, dir, "new.txt")
	if err != nil {
		t.Fatalf("DiffNoIndex: %v", err)
	}
	if !strings.Contains(diff, "new file mode 100644") {
		t.Fatalf("expected new file mode, got:\n%s", diff)
	}
	if !fullIndexAddLine.MatchString(diff) {
		t.Fatalf("expected full-index add line, got:\n%s", diff)
	}
}

func TestFileModeAtCommit(t *testing.T) {
	ctx := context.Background()
	dir := initGitRepo(t)
	writeFile(t, filepath.Join(dir, "plain.txt"), "x\n")
	writeFile(t, filepath.Join(dir, "tool.sh"), "#!/bin/sh\n")
	if err := os.Chmod(filepath.Join(dir, "tool.sh"), 0o755); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	runGit(t, dir, "add", "plain.txt", "tool.sh")
	runGit(t, dir, "commit", "-m", "base")

	mode, err := FileModeAtCommit(ctx, dir, "HEAD", "plain.txt")
	if err != nil {
		t.Fatalf("FileModeAtCommit plain: %v", err)
	}
	if mode != "100644" {
		t.Fatalf("plain mode = %q, want 100644", mode)
	}
	mode, err = FileModeAtCommit(ctx, dir, "HEAD", "tool.sh")
	if err != nil {
		t.Fatalf("FileModeAtCommit exec: %v", err)
	}
	if mode != "100755" {
		t.Fatalf("exec mode = %q, want 100755", mode)
	}
	if _, err := FileModeAtCommit(ctx, dir, "HEAD", "missing.txt"); err == nil {
		t.Fatalf("expected error for missing path")
	}
}

func initGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init")
	runGit(t, dir, "config", "user.name", "Test User")
	runGit(t, dir, "config", "user.email", "test@example.com")
	return dir
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, string(output))
	}
}

func writeFile(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}

func TestRunReturnsContextError(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	config := []byte("[alias]\n\thold = !sleep 5\n")
	if err := os.WriteFile(filepath.Join(home, ".gitconfig"), config, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	if _, err := Run(ctx, t.TempDir(), nil, "hold"); err == nil {
		t.Fatalf("expected timeout error")
	}
	if ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("expected context deadline exceeded, got %v", ctx.Err())
	}
}
