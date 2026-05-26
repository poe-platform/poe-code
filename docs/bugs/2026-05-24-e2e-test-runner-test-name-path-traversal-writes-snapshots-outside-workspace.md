# E2E test runner accepts test-name path traversal and writes snapshots outside the workspace

## Summary

`@poe-code/e2e-test-runner` uses `ContainerOptions.testName` as a path component beneath `.snapshots` without validating that it is a simple test identifier. Supplying `../../outside` makes `Container.writeSnapshots()` write snapshot JSON outside the configured workspace without requiring any symlink.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-traversal-"));
   const project = path.join(root, "project");
   await fs.mkdir(project, { recursive: true });
   setWorkspaceDir(project);

   const container = await createHostContainer(
     { useSnapshots: true, testName: "../../outside" },
     () => ({ bin: "true", args: [] })
   );

   try {
     await container.writeSnapshots([{ key: "captured", response: { escaped: true } }]);
     console.log(await fs.readFile(path.join(root, "outside", "captured.json"), "utf8"));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

`createHostContainer()` accepts the traversal-bearing `testName`, and `writeSnapshots()` successfully creates `outside/captured.json` alongside the project rather than beneath `project/.snapshots`. The confirmed probe read the JSON payload from that escaped location.

Although snapshot keys are restricted by `isSafeSnapshotKey()` in `packages/e2e-test-runner/src/host-container.ts:132`, the parent directory is formed by `resolve(repoDir, E2E_FIXTURES_DIR, options.testName)` in `packages/e2e-test-runner/src/host-container.ts:285` and written in `packages/e2e-test-runner/src/host-container.ts:453` without any containment validation.

## Expected Behavior

`testName` should be validated as a safe snapshot directory identifier, or the derived snapshot directory should be verified to remain within the workspace `.snapshots` tree before reads or writes occur.

## Impact

A caller able to supply or influence an E2E test name can direct snapshot fixture output to arbitrary locations relative to the workspace parent. This enables external file creation or overwrite during snapshot recording and defeats the apparent `.snapshots` storage boundary.
