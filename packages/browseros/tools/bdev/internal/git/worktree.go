package git

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"
)

func CheckoutFiles(dir, ref string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	args := []string{"checkout", ref, "--"}
	args = append(args, paths...)
	_, err := Run(dir, args...)
	return err
}

func Apply(dir string, patchContent []byte) (string, error) {
	if err := runApply(dir, patchContent, "--ignore-whitespace", "--whitespace=nowarn", "-p1"); err == nil {
		return "", nil
	}
	if err := runApply(dir, patchContent, "--ignore-whitespace", "--whitespace=nowarn", "-p1", "--3way"); err == nil {
		return "", nil
	}
	detail, err := applyWithStderr(dir, patchContent, "--reject", "--ignore-whitespace", "--whitespace=nowarn", "-p1")
	if err != nil {
		return detail, err
	}
	return "patch applied with rejects", nil
}

func runApply(dir string, patchContent []byte, flags ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	args := append([]string{"apply"}, flags...)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Stdin = bytes.NewReader(patchContent)
	return cmd.Run()
}

func applyWithStderr(dir string, patchContent []byte, flags ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	args := append([]string{"apply"}, flags...)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Stdin = bytes.NewReader(patchContent)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err == nil {
		return "", nil
	}
	return stderr.String(), fmt.Errorf("git apply failed: %w", err)
}
