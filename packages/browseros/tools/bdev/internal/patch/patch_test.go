package patch

import (
	"path/filepath"
	"testing"
)

func TestParseDiffOutputDetectsRenameAndDeleteSignatures(t *testing.T) {
	renameDiff := `diff --git a/chrome/old.cc b/chrome/new.cc
similarity index 100%
rename from chrome/old.cc
rename to chrome/new.cc
`
	deleteDiff := `diff --git a/chrome/dead.cc b/chrome/dead.cc
deleted file mode 100644
index 123..000 100644
--- a/chrome/dead.cc
+++ /dev/null
@@ -1 +0,0 @@
-gone
`
	renameSet, err := ParseDiffOutput(renameDiff)
	if err != nil {
		t.Fatalf("ParseDiffOutput rename: %v", err)
	}
	deleteSet, err := ParseDiffOutput(deleteDiff)
	if err != nil {
		t.Fatalf("ParseDiffOutput delete: %v", err)
	}
	renamePatch := renameSet["chrome/new.cc"]
	if !renamePatch.IsPureRename() {
		t.Fatalf("expected pure rename patch")
	}
	if deletePatch := deleteSet["chrome/dead.cc"]; signature(deletePatch) != "delete:chrome/dead.cc" {
		t.Fatalf("unexpected delete signature: %s", signature(deletePatch))
	}
}

func TestWriteRepoPatchSetWritesMarkersAndReloads(t *testing.T) {
	patchesDir := t.TempDir()
	set := PatchSet{
		"chrome/dead.cc": {
			Path: "chrome/dead.cc",
			Op:   OpDelete,
		},
		"chrome/new.cc": {
			Path:       "chrome/new.cc",
			Op:         OpRename,
			OldPath:    "chrome/old.cc",
			Similarity: 100,
			Content: []byte(`diff --git a/chrome/old.cc b/chrome/new.cc
similarity index 100%
rename from chrome/old.cc
rename to chrome/new.cc
`),
		},
	}
	if _, _, err := WriteRepoPatchSet(patchesDir, set, nil); err != nil {
		t.Fatalf("WriteRepoPatchSet: %v", err)
	}
	if _, err := filepath.Abs(filepath.Join(patchesDir, "chrome", "dead.cc.deleted")); err != nil {
		t.Fatalf("abs: %v", err)
	}
	loaded, err := LoadRepoPatchSet(patchesDir, nil)
	if err != nil {
		t.Fatalf("LoadRepoPatchSet: %v", err)
	}
	if loaded["chrome/dead.cc"].Op != OpDelete {
		t.Fatalf("expected delete marker to round-trip")
	}
	if !loaded["chrome/new.cc"].IsPureRename() {
		t.Fatalf("expected rename marker to round-trip")
	}
}
