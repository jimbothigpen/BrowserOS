#!/usr/bin/env python3
"""Tests for the shared server-binary sign table."""

import unittest
from pathlib import Path

from .server_binaries import (
    MACOS_SERVER_BINARIES,
    WINDOWS_SERVER_BINARIES,
    expected_windows_binary_paths,
    macos_sign_spec_for,
)

ENTITLEMENTS_DIR = Path(__file__).resolve().parents[2] / "resources" / "entitlements"


class MacosServerBinariesTest(unittest.TestCase):
    def test_every_entry_has_identifier_and_options(self):
        for stem, spec in MACOS_SERVER_BINARIES.items():
            self.assertTrue(spec.identifier_suffix, f"{stem} missing identifier_suffix")
            self.assertTrue(spec.options, f"{stem} missing options")

    def test_every_entitlements_plist_exists_on_disk(self):
        for stem, spec in MACOS_SERVER_BINARIES.items():
            if spec.entitlements is None:
                continue
            plist = ENTITLEMENTS_DIR / spec.entitlements
            self.assertTrue(plist.exists(), f"{stem}: entitlements {plist} missing")

    def test_macos_sign_spec_for_resolves_by_stem(self):
        spec = macos_sign_spec_for(Path("/x/podman-mac-helper"))
        assert spec is not None
        self.assertEqual(spec.identifier_suffix, "podman_mac_helper")
        self.assertIsNone(macos_sign_spec_for(Path("/x/not_a_known_binary")))

    def test_matches_podman_bundle_layout(self):
        required = {"podman", "gvproxy", "vfkit", "krunkit", "podman-mac-helper"}
        self.assertTrue(required.issubset(MACOS_SERVER_BINARIES.keys()))


class WindowsServerBinariesTest(unittest.TestCase):
    def test_no_duplicates(self):
        self.assertEqual(
            len(WINDOWS_SERVER_BINARIES), len(set(WINDOWS_SERVER_BINARIES))
        )

    def test_paths_within_expected_layout(self):
        for rel in WINDOWS_SERVER_BINARIES:
            self.assertTrue(
                rel == "browseros_server.exe" or rel.startswith("third_party/"),
                f"{rel} outside expected layout",
            )

    def test_expected_windows_binary_paths_joins_root(self):
        root = Path("/tmp/fake/resources/bin")
        resolved = expected_windows_binary_paths(root)
        self.assertEqual(len(resolved), len(WINDOWS_SERVER_BINARIES))
        for rel, abs_path in zip(WINDOWS_SERVER_BINARIES, resolved):
            self.assertEqual(abs_path, root / rel)


if __name__ == "__main__":
    unittest.main()
