---
name: Native build portability
description: Replit package-install details that affect Expo cloud builds and WebRTC dependency resolution.
---

Check newly installed dependencies for internal registry tarball URLs before an external native build. Do not change the workspace registry or bypass the package firewall.

**Why:** An approved package installation wrote internal Replit tarball URLs into the lockfile. Expo's external builder could not resolve that host and failed during dependency installation, before native compilation.

**How to apply:** After packages have passed the normal installation checks, make their lockfile download URLs externally reachable without changing versions or integrity hashes. Verify the public registry metadata has the same integrity before submitting again.

WebRTC must resolve its own event-target-shim version, not the older version used by the app's abort-controller dependency.

**Why:** Its source/declarations import a legacy `/index` subpath that the newer shim no longer exports. The package still implements the native event listener methods, but modern module resolution can fail to inherit their types.

**How to apply:** Check the installed library's current imports and types before upgrading. Keep any resolution adjustment scoped to WebRTC's package context; do not globally redirect React Native's shim.
