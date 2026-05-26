# E2E persistent container accepts test-name path traversal and creates a snapshot directory outside the workspace

## Summary

`createPersistentContainer()` derives a host snapshot directory from `ContainerOptions.testName` without validating containment beneath the workspace `.snapshots` directory. In snapshot recording mode, a traversal-bearing name such as `../../created-outside` makes startup create a directory outside the configured workspace before any container execution occurs.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-record-"));
   const fakeBin = path.join(root, "bin");
   const project = path.join(root, "project");
   const outside = path.join(root, "created-outside");
   await fs.mkdir(fakeBin, { recursive: true });
   await fs.mkdir(project, { recursive: true });
   await fs.writeFile(
     path.join(fakeBin, "podman"),
     "#!/bin/sh\ncase \"$1\" in --version) echo fake;; create) echo fake-container;; esac\nexit 0\n",
     { mode: 0o755 }
   );

   process.env.PATH = `${fakeBin}:${process.env.PATH}`;
   process.env.POE_SNAPSHOT_MODE = "record";
   const { createPersistentContainer } = await import(
     "./packages/e2e-test-runner/src/persistent-container.ts"
   );
   const { setWorkspaceDir } = await import("./packages/e2e-test-runner/src/runtime.ts");
   setWorkspaceDir(project);

   const container = await createPersistentContainer({
     image: "fake:image",
     useSnapshots: true,
     testName: "../../created-outside"
   });
   await container.destroy();
   console.log((await fs.stat(outside)).isDirectory());
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The probe prints `true`: `createPersistentContainer()` creates `created-outside` beside the workspace rather than a test fixture directory beneath `project/.snapshots`. The fake `podman` executable only makes the container lifecycle return successfully; the escaped directory creation is performed locally by the E2E package itself.

`createPersistentContainer()` constructs `hostSnapshotDir` using `resolve(workspace, snapshotDir)` after interpolating `options.testName` in `packages/e2e-test-runner/src/persistent-container.ts:214`, then calls `mkdirSync(hostSnapshotDir, { recursive: true })` in recording mode at `packages/e2e-test-runner/src/persistent-container.ts:232` without containment validation.

## Expected Behavior

Persistent-container snapshot setup should only create host fixture directories within the configured workspace `.snapshots` tree. Traversal-bearing `testName` values should be rejected or safely confined.

## Impact

A test caller or crafted configuration can make Podman-backed E2E setup create directories outside the workspace before running a container. This violates workspace isolation and can prepare or interfere with arbitrary host filesystem locations accessible to the test runner.
