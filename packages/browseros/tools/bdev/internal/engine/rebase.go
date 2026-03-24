package engine

import (
	"bdev/internal/git"
	"bdev/internal/patch"
	"bdev/internal/session"
	"bdev/internal/ui"
)

type RebaseResult struct {
	Updated  []string
	Session  *session.Session
	RepoHead string
}

func Rebase(ctx *Context, activity *ui.Activity) (*RebaseResult, error) {
	if ctx.Checkout.LastSyncedRev == "" {
		return nil, fail("checkout has no synced revision yet; run bdev apply --all --clean first")
	}
	if err := requireCleanPatchRepo(ctx); err != nil {
		return nil, err
	}
	head, err := git.HeadRev(ctx.PatchRepo.BrowserOSRepo)
	if err != nil {
		return nil, err
	}
	result := &RebaseResult{RepoHead: head}
	if head == ctx.Checkout.LastSyncedRev {
		return result, nil
	}
	upstreamPaths, err := git.DiffChangedPathsBetween(ctx.PatchRepo.BrowserOSRepo, ctx.Checkout.LastSyncedRev, head)
	if err != nil {
		return nil, err
	}
	localStatus, err := git.DiffNameStatus(ctx.Checkout.ChromiumRoot, ctx.PatchRepo.BaseCommit)
	if err != nil {
		return nil, err
	}
	overlap := intersect(localStatus, upstreamPaths)
	if len(overlap) == 0 {
		syncResult, err := Sync(ctx, activity)
		if err != nil {
			return nil, err
		}
		return &RebaseResult{Updated: syncResult.Updated, Session: syncResult.Session, RepoHead: syncResult.RepoHead}, nil
	}
	overlayPatches := map[string][]byte{}
	for _, path := range overlap {
		baseData, baseExists, err := baseFile(ctx, path)
		if err != nil {
			return nil, err
		}
		oldRepoPatch, ok, err := oldPatch(ctx, path)
		if err != nil {
			return nil, err
		}
		oldData := baseData
		oldExists := baseExists
		if ok {
			switch oldRepoPatch.Op {
			case patch.OpDeleted:
				oldData = nil
				oldExists = false
			default:
				oldData, oldExists, err = materializeState(baseData, baseExists, oldRepoPatch.Content, path)
				if err != nil {
					return nil, err
				}
			}
		}
		currentData, currentExists, err := currentFile(ctx, path)
		if err != nil {
			return nil, err
		}
		overlay, err := buildOverlayPatch(path, oldData, oldExists, currentData, currentExists)
		if err != nil {
			return nil, err
		}
		if len(overlay) > 0 {
			overlayPatches[path] = overlay
		}
	}
	sess := &session.Session{
		CheckoutID:  ctx.Checkout.ID,
		Kind:        "rebase",
		FromRepoRev: ctx.Checkout.LastSyncedRev,
		ToRepoRev:   head,
	}
	upstreamFailed := map[string]bool{}
	for _, path := range upstreamPaths {
		fp, ok, err := patch.ReadCurrentPatch(ctx.PatchRepo.BrowserOSRepo, path)
		if err != nil {
			return nil, err
		}
		if err := resetPathToBase(ctx, path); err != nil {
			return nil, err
		}
		if !ok || fp.Op == patch.OpDeleted {
			result.Updated = append(result.Updated, path)
			continue
		}
		detail, err := git.Apply(ctx.Checkout.ChromiumRoot, fp.Content)
		if err != nil || detail != "" {
			upstreamFailed[path] = true
			sess.Pending = append(sess.Pending, session.ConflictEntry{
				Path: path, Stage: "sync", PatchContent: string(fp.Content), Error: detail,
			})
			continue
		}
		result.Updated = append(result.Updated, path)
	}
	for path, overlay := range overlayPatches {
		if upstreamFailed[path] {
			continue
		}
		detail, err := git.Apply(ctx.Checkout.ChromiumRoot, overlay)
		if err != nil || detail != "" {
			sess.Pending = append(sess.Pending, session.ConflictEntry{
				Path: path, Stage: "overlay", PatchContent: string(overlay), Error: detail,
			})
		}
	}
	if len(sess.Pending) > 0 {
		if err := session.Save(sess); err != nil {
			return nil, err
		}
		result.Session = sess
		return result, nil
	}
	if err := session.Delete(ctx.Checkout.ID); err != nil {
		return nil, err
	}
	return result, nil
}
