# E2E persistent container follows a symlinked snapshot directory and imports fixtures from outside the workspace

## Summary

`createPersistentContainer()` treats `.snapshots/<testName>` as a host fixture source for Podman playback, but does not reject a symlink at that workspace-local path. A symlinked snapshot directory causes startup to import external files into the container's proxy snapshot store.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-symlink-"));
   const fakeBin = path.join(root, "bin");
   const log = path.join(root, "podman.log");
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");
   await fs.mkdir(fakeBin, { recursive: true });
   await fs.mkdir(path.join(project, ".snapshots"), { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(path.join(outside, "fixture.json"), "{\"external\":true}", "utf8");
   await fs.symlink(outside, path.join(project, ".snapshots", "case"));
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
     testName: "case"
   });
   await container.destroy();
   console.log(await fs.readFile(log, "utf8"));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The fake-Podman log shows startup copying `project/.snapshots/case/.` into `/tmp/proxy-snapshots/`, while `project/.snapshots/case` resolves to the external fixture directory. Thus Podman playback setup trusts and imports files reached through the workspace symlink.

`createPersistentContainer()` resolves the lexical snapshot path in `packages/e2e-test-runner/src/persistent-container.ts:214`, considers it enabled based on host filesystem checks, and supplies it to `cp` in `packages/e2e-test-runner/src/persistent-container.ts:294` without canonical containment validation.

## Expected Behavior

Podman-backed playback imports should reject snapshot directories that resolve outside the configured workspace, rather than consuming external fixture contents through symlinks.

## Impact

A crafted workspace can make persistent-container playback import externally controlled snapshot data into the running test container. This may manipulate proxy playback behavior and test results while preserving an apparently local `.snapshots/case` path in the project.
