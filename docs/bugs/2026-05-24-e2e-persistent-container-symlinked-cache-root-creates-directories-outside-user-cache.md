# E2E persistent container follows a symlinked cache root and creates directories outside the user cache

## Summary

`createPersistentContainer()` automatically creates Podman cache directories beneath the default `~/.cache/poe-e2e` root. If that state root is a symlink, normal container creation follows it and materializes `root-npm` and `root-cache-uv` directories at an external target.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const home = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-home-"));
   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-cache-"));
   const fakeBin = path.join(root, "bin");
   const project = path.join(root, "project");
   const outside = path.join(root, "outside-cache");
   await fs.mkdir(path.join(home, ".cache"), { recursive: true });
   await fs.mkdir(fakeBin, { recursive: true });
   await fs.mkdir(project, { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.symlink(outside, path.join(home, ".cache", "poe-e2e"));
   await fs.writeFile(
     path.join(fakeBin, "podman"),
     "#!/bin/sh\ncase \"$1\" in --version) echo fake;; create) echo fake-container;; esac\nexit 0\n",
     { mode: 0o755 }
   );

   process.env.HOME = home;
   process.env.PATH = `${fakeBin}:${process.env.PATH}`;
   const { createPersistentContainer } = await import(
     "./packages/e2e-test-runner/src/persistent-container.ts"
   );
   const { setWorkspaceDir } = await import("./packages/e2e-test-runner/src/runtime.ts");
   setWorkspaceDir(project);

   const container = await createPersistentContainer({ image: "fake:image" });
   await container.destroy();
   console.log(await fs.readdir(outside));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The external directory contains `root-npm` and `root-cache-uv` after `createPersistentContainer()` runs. Those directories are created through the symlink at the default-looking `HOME/.cache/poe-e2e` path before any real Podman work is necessary.

`packages/e2e-test-runner/src/runtime.ts:6` defines `E2E_CACHE_ROOT` from the user's home directory, and `ensureCacheDirs()` creates its child directories in `packages/e2e-test-runner/src/persistent-container.ts:123`. No canonical validation prevents the cache-root symlink from redirecting these writes externally.

## Expected Behavior

Automatically managed persistent-container cache directories should remain within the intended user cache root, or the package should reject a symlinked state root that escapes it.

## Impact

A crafted user state path or pre-existing symlink can redirect automatic Podman E2E cache initialization into arbitrary writable locations. This creates host directories outside the advertised cache boundary whenever persistent-container setup runs.
