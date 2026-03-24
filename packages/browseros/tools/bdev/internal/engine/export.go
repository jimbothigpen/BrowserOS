package engine

import (
	"bytes"
	"path/filepath"
	"slices"
	"strings"

	"bdev/internal/feature"
	"bdev/internal/git"
	"bdev/internal/patch"
	"bdev/internal/ui"
)

type ExportOpts struct {
	Paths      []string
	TagFeature string
}

type ExportResult struct {
	Updated  []string
	Removed  []string
	Warnings []string
}

func Export(ctx *Context, opts ExportOpts, activity *ui.Activity) (*ExportResult, error) {
	result := &ExportResult{}
	status, err := git.DiffNameStatus(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit)
	if err != nil {
		return nil, err
	}
	paths := opts.Paths
	if len(paths) == 0 {
		for path := range status {
			paths = append(paths, path)
		}
	}
	slices.Sort(paths)
	done := activity.Start("write exported patch files")
	for _, path := range paths {
		state, ok := status[path]
		if !ok {
			if err := patch.Remove(ctx.PatchRepo.BrowserOSRepo, path); err != nil {
				done(false, "")
				return nil, err
			}
			result.Removed = append(result.Removed, path)
			continue
		}
		switch state {
		case "D":
			if err := patch.Write(ctx.PatchRepo.BrowserOSRepo, &patch.FilePatch{Path: path, Op: patch.OpDeleted}); err != nil {
				done(false, "")
				return nil, err
			}
			result.Updated = append(result.Updated, path)
		default:
			diff, err := git.DiffFile(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit, path)
			if err != nil {
				done(false, "")
				return nil, err
			}
			if len(diff) == 0 {
				diff, err = git.DiffNoIndex("/dev/null", filepath.Join(ctx.Checkout.ChromiumRoot, path))
				if err != nil {
					done(false, "")
					return nil, err
				}
				diff = normalizeExportPatch(path, diff)
			}
			if err := patch.Write(ctx.PatchRepo.BrowserOSRepo, &patch.FilePatch{Path: path, Op: patch.OpPatch, Content: diff}); err != nil {
				done(false, "")
				return nil, err
			}
			result.Updated = append(result.Updated, path)
		}
	}
	if opts.TagFeature != "" {
		if err := feature.TagFeature(feature.TagFeatureOpts{
			BrowserOSRepo: ctx.PatchRepo.BrowserOSRepo,
			FeatureName:   opts.TagFeature,
			Paths:         append(append([]string{}, result.Updated...), result.Removed...),
		}); err != nil {
			result.Warnings = append(result.Warnings, err.Error())
		}
	}
	done(true, "")
	return result, nil
}

func normalizeExportPatch(path string, raw []byte) []byte {
	if len(bytes.TrimSpace(raw)) == 0 {
		return raw
	}
	lines := strings.Split(string(raw), "\n")
	for i, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			lines[i] = "diff --git a/" + path + " b/" + path
		case strings.HasPrefix(line, "--- "):
			if !strings.Contains(line, "/dev/null") {
				lines[i] = "--- a/" + path
			}
		case strings.HasPrefix(line, "+++ "):
			if !strings.Contains(line, "/dev/null") {
				lines[i] = "+++ b/" + path
			}
		}
	}
	return []byte(strings.Join(lines, "\n"))
}
