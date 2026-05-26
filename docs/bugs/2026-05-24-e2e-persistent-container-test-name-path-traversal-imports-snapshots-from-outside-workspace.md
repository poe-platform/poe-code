# E2E persistent container accepts test-name path traversal and imports snapshots from outside the workspace

## Summary

`createPersistentContainer()` uses unvalidated `ContainerOptions.testName` to locate host-side playback fixtures. A traversal-bearing name such as `../../outside` causes Podman-mode setup to import JSON files from outside the configured workspace into the proxy snapshot directory.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-import-"));
   const fakeBin = path.join(root, "bin");
   const log = path.join(root, "podman.log");
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");
   await fs.mkdir(fakeBin, { recursive: true });
   await fs.mkdir(project, { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(path.join(outside, "fixture.json"), "{\"external\":true}", "utf8");
   await fs.writeFile(
     path.join(fakeBin, "podman"),
     `#!/bin/sh
   printf '%s\n' "$*" >> "$POE_PODMAN_LOG"
   case "$1" in --version) echo fake;; create) echo fake-container;; esac
   exit 0
   `,
     { mode: 0o755 }
   );

   process.env.PATH = `${fakeBin}:${process.env.PATH}`;
   process.env.POE_PODMAN_LOG = log;
   const { createPersistentContainer } = await import(
     "./packages/e2e-test-runner/src/persistent-container.ts"
   );
   const { setWorkspaceDir } = await import("./packages/e2e-test-runner/src/runtime.ts");
   setWorkspaceDir(project);

   const container = await createPersistentContainer({
     image: "fake:image",
     useSnapshots: true,
     testName: "../../outside"
   });
   await container.destroy();
   console.log(await fs.readFile(log, "utf8"));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The recorded fake-Podman invocation includes a host import command equivalent to `cp <root>/outside/. fake-container:/tmp/proxy-snapshots/`. The selected playback source is outside the configured project rather than beneath `project/.snapshots`.

`createPersistentContainer()` derives `hostSnapshotDir` from `resolve(workspace, `${E2E_FIXTURES_DIR}/${options.testName}`)` in `packages/e2e-test-runner/src/persistent-container.ts:214`, then imports every entry with `cp` in `packages/e2e-test-runner/src/persistent-container.ts:294` without enforcing the workspace snapshot boundary.

## Expected Behavior

Persistent playback fixture imports should only originate from canonical locations within the configured workspace `.snapshots` tree. Traversal-bearing `testName` values should be rejected.

## Impact

A caller controlling `testName` can feed external host files into Podman-backed snapshot playback setup. Those imported fixtures may then influence proxied responses and test outcomes while bypassing the advertised workspace-local snapshot source.
