package patch

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	_jsii "github.com/browseros-ai/BrowserOS/packages/browseros/tools/bdev/internal/git"
)

func BuildWorkingTreePatchSet(ctx context.Context, workspacePath string, base string, filters []string) (PatchSet, error) {
	diff, err := _jsii.DiffText(ctx, workspacePath, base)
	if err != nil {
		return nil, err
	}
	set, err := ParseDiffOutput(diff)
	if err != nil {
		return nil, err
	}
	untracked, err := _jsii.ListUntracked(ctx, workspacePath, filters)
	if err != nil {
		return nil, err
	}
	for _, rel := range untracked {
		diffText, err := _jsii.DiffNoIndex(ctx, workspacePath, rel)
		if err != nil {
			return nil, err
		}
		untrackedSet, err := ParseDiffOutput(diffText)
		if err != nil {
			return nil, err
		}
		for patchPath, patchFile := range untrackedSet {
			set[patchPath] = patchFile
		}
	}
	return filterSet(set, filters), nil
}

func BuildCommitPatchSet(ctx context.Context, workspacePath string, ref string, base string, filters []string) (PatchSet, error) {
	if base == "" {
		diff, err := _jsii.DiffText(ctx, workspacePath, ref+"^.."+ref)
		if err != nil {
			return nil, err
		}
		set, err := ParseDiffOutput(diff)
		if err != nil {
			return nil, err
		}
		return filterSet(set, filters), nil
	}
	changes, err := _jsii.DiffTreeNameStatus(ctx, workspacePath, ref, filters)
	if err != nil {
		return nil, err
	}
	return buildBaseScopedSet(ctx, workspacePath, ref, base, changes)
}

func BuildRangePatchSet(ctx context.Context, workspacePath string, start string, end string, base string, squash bool, filters []string) (PatchSet, error) {
	if squash {
		if base == "" {
			diff, err := _jsii.DiffText(ctx, workspacePath, start+".."+end)
			if err != nil {
				return nil, err
			}
			set, err := ParseDiffOutput(diff)
			if err != nil {
				return nil, err
			}
			return filterSet(set, filters), nil
		}
		changes, err := _jsii.DiffNameStatusBetween(ctx, workspacePath, start, end, filters)
		if err != nil {
			return nil, err
		}
		return buildBaseScopedSet(ctx, workspacePath, end, base, changes)
	}

	commits, err := _jsii.RevListRange(ctx, workspacePath, start, end)
	if err != nil {
		return nil, err
	}
	set := PatchSet{}
	seen := map[string]bool{}
	for _, commit := range commits {
		var current PatchSet
		if base == "" {
			diff, err := _jsii.DiffText(ctx, workspacePath, commit+"^.."+commit)
			if err != nil {
				return nil, err
			}
			current, err = ParseDiffOutput(diff)
			if err != nil {
				return nil, err
			}
		} else {
			changes, err := _jsii.DiffTreeNameStatus(ctx, workspacePath, commit, filters)
			if err != nil {
				return nil, err
			}
			current, err = buildBaseScopedSet(ctx, workspacePath, commit, base, changes)
			if err != nil {
				return nil, err
			}
		}
		for rel, patchFile := range filterSet(current, filters) {
			if seen[rel] {
				continue
			}
			set[rel] = patchFile
			seen[rel] = true
		}
	}
	return set, nil
}

func buildBaseScopedSet(ctx context.Context, workspacePath string, ref string, base string, changes []_jsii.FileChange) (PatchSet, error) {
	set := PatchSet{}
	for _, change := range changes {
		rel := NormalizeChromiumPath(change.Path)
		diff, err := _jsii.DiffText(ctx, workspacePath, base, ref, "--", rel)
		if err != nil {
			return nil, err
		}
		switch {
		case strings.TrimSpace(diff) != "":
			patches, err := ParseDiffOutput(diff)
			if err != nil {
				return nil, err
			}
			for patchPath, patchFile := range patches {
				set[patchPath] = patchFile
			}
		case change.Status == "D":
			exists, err := _jsii.FileExistsAtCommit(ctx, workspacePath, base, rel)
			if err != nil {
				return nil, err
			}
			if exists {
				set[rel] = FilePatch{Path: rel, Op: OpDelete}
			}
		case change.Status == "A":
			content, err := _jsii.ShowFile(ctx, workspacePath, ref, rel)
			if err != nil {
				return nil, err
			}
			set[rel] = syntheticAddPatch(rel, content)
		}
	}
	return set, nil
}

func filterSet(set PatchSet, filters []string) PatchSet {
	filtered := PatchSet{}
	for rel, patchFile := range set {
		if !PathMatches(rel, filters) {
			continue
		}
		filtered[rel] = patchFile
	}
	return filtered
}

func ScopeFromSet(set PatchSet) []string {
	paths := make([]string, 0, len(set))
	for rel := range set {
		paths = append(paths, rel)
	}
	slices.Sort(paths)
	return paths
}

func RejectPath(workspacePath string, rel string) string {
	return filepath.Join(workspacePath, filepath.FromSlash(rel+".rej"))
}

func syntheticAddPatch(rel string, content []byte) FilePatch {
	body := string(content)
	if body != "" && body[len(body)-1] != '\n' {
		body += "\n"
	}
	patchBody := fmt.Sprintf(
		"diff --git a/%s b/%s\nnew file mode 100644\n--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n%s",
		rel,
		rel,
		rel,
		countLines(body),
		prefixLines(body, "+"),
	)
	return FilePatch{Path: rel, Op: OpAdd, Content: []byte(patchBody)}
}

func countLines(body string) int {
	if body == "" {
		return 0
	}
	return len(strings.Split(strings.TrimSuffix(body, "\n"), "\n"))
}

func prefixLines(body string, prefix string) string {
	lines := strings.Split(strings.TrimSuffix(body, "\n"), "\n")
	for idx, line := range lines {
		lines[idx] = prefix + line
	}
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}
