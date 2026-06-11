// Package modules assembles the registry of build modules, mirroring
// AVAILABLE_MODULES in cli/build.py. Registry keys are the exact module
// names used by build/config/*.yaml.
package modules

import (
	"fmt"

	"github.com/browseros-ai/BrowserOS/packages/browseros/build_go/internal/buildctx"
	"github.com/browseros-ai/BrowserOS/packages/browseros/build_go/internal/modules/resources"
	"github.com/browseros-ai/BrowserOS/packages/browseros/build_go/internal/modules/setup"
	"github.com/browseros-ai/BrowserOS/packages/browseros/build_go/internal/pipeline"
)

// notPorted is a placeholder for modules whose port has not landed yet; it
// fails validation with a pointer at the Python tool.
type notPorted struct {
	name        string
	description string
}

func (m notPorted) Name() string        { return m.name }
func (m notPorted) Description() string { return m.description }
func (m notPorted) Validate(*buildctx.Context) error {
	return fmt.Errorf("module %s is not ported to Go yet — use `uv run browseros` meanwhile", m.name)
}
func (m notPorted) Execute(*buildctx.Context) error {
	return fmt.Errorf("module %s is not ported to Go yet", m.name)
}

func placeholder(name, description string) func() pipeline.Module {
	return func() pipeline.Module { return notPorted{name: name, description: description} }
}

// Available returns the full module registry (cli/build.py AVAILABLE_MODULES).
func Available() pipeline.Registry {
	return pipeline.Registry{
		// Setup & Environment
		"clean":         func() pipeline.Module { return setup.NewClean() },
		"git_setup":     func() pipeline.Module { return setup.NewGitSetup() },
		"sparkle_setup": func() pipeline.Module { return setup.NewSparkleSetup() },
		"configure":     func() pipeline.Module { return setup.NewConfigure() },
		// Patches & Resources
		"patches":            placeholder("patches", "Apply BrowserOS patches"),
		"series_patches":     placeholder("series_patches", "Apply series patches (GNU Quilt format)"),
		"chromium_replace":   func() pipeline.Module { return resources.NewChromiumReplace() },
		"string_replaces":    func() pipeline.Module { return resources.NewStringReplaces() },
		"download_resources": func() pipeline.Module { return resources.NewDownload() },
		"resources":          func() pipeline.Module { return resources.NewCopy() },
		"bundled_extensions": placeholder("bundled_extensions", "Download bundled extensions from CDN"),
		// Build
		"compile":         placeholder("compile", "Compile BrowserOS with autoninja"),
		"universal_build": placeholder("universal_build", "Build macOS universal binary (arm64 + x64)"),
		// Sign (platform-specific, validated at runtime)
		"sign_macos":   placeholder("sign_macos", "Sign and notarize macOS app"),
		"sign_windows": placeholder("sign_windows", "Sign Windows binaries with eSigner"),
		"sign_linux":   placeholder("sign_linux", "Sign Linux binaries (no-op)"),
		"sparkle_sign": placeholder("sparkle_sign", "Sign update archive for Sparkle auto-update (macOS)"),
		// Package (platform-specific, validated at runtime)
		"package_macos":   placeholder("package_macos", "Create macOS DMG package"),
		"package_windows": placeholder("package_windows", "Create Windows installer package"),
		"package_linux":   placeholder("package_linux", "Create Linux AppImage and .deb packages"),
		// Storage
		"upload": placeholder("upload", "Upload artifacts to R2"),
	}
}
