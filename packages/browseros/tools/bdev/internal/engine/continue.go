package engine

import (
	"slices"

	"bdev/internal/git"
	"bdev/internal/session"
	"bdev/internal/ui"
)

type ContinueResult struct {
	Remaining int
}

func Continue(ctx *Context, activity *ui.Activity) (*ContinueResult, error) {
	if err := requireCleanPatchRepo(ctx); err != nil {
		return nil, err
	}
	sess, err := session.Load(ctx.Checkout.ID)
	if err != nil {
		return nil, err
	}
	done := activity.Start("retry pending patches")
	next := []session.ConflictEntry{}
	for _, entry := range sess.Pending {
		detail, err := git.Apply(ctx.Checkout.ChromiumRoot, []byte(entry.PatchContent))
		if err != nil || detail != "" {
			entry.Error = detail
			next = append(next, entry)
			continue
		}
		sess.Resolved = append(sess.Resolved, entry.Path)
	}
	slices.Sort(sess.Resolved)
	sess.Pending = next
	if len(next) == 0 {
		if err := session.Delete(ctx.Checkout.ID); err != nil {
			done(false, "")
			return nil, err
		}
		done(true, "")
		return &ContinueResult{}, nil
	}
	if err := session.Save(sess); err != nil {
		done(false, "")
		return nil, err
	}
	done(true, "")
	return &ContinueResult{Remaining: len(next)}, nil
}
