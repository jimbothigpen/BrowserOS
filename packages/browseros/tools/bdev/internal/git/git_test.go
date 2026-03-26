package git

import (
	"context"
	"testing"
)

func TestRunReturnsContextError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := Run(ctx, t.TempDir(), nil, "status"); err == nil {
		t.Fatalf("expected context cancellation error")
	}
}
