# E2E test runner follows a symlinked snapshot directory and writes fixtures outside the workspace

## Summary

`@poe-code/e2e-test-runner` stores response snapshots under the workspace-relative `.snapshots/<testName>` directory. If that test directory is a symlink, `Container.writeSnapshots()` follows it and writes JSON fixtures outside the configured workspace.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-snapshot-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");

   await fs.mkdir(path.join(project, ".snapshots"), { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.symlink(outside, path.join(project, ".snapshots", "case"));
   setWorkspaceDir(project);

   const container = await createHostContainer(
     { useSnapshots: true, testName: "case" },
     () => ({ bin: "true", args: [] })
   );

   try {
     await container.writeSnapshots([{ key: "captured", response: { ok: true } }]);
     console.log(await fs.readFile(path.join(outside, "captured.json"), "utf8"));
     console.log(await fs.realpath(path.join(project, ".snapshots", "case")));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The container API accepts the workspace-local-looking snapshot configuration and writes `captured.json` into the external `outside` directory reached through `.snapshots/case`. The confirmed probe read the JSON response fixture from the external target after `writeSnapshots()` returned successfully.

`createHostContainer()` calculates `snapshotDir` beneath the selected workspace in `packages/e2e-test-runner/src/host-container.ts:285`, but `writeSnapshots()` later creates and writes directly under that path in `packages/e2e-test-runner/src/host-container.ts:453` without checking its canonical location.

## Expected Behavior

Snapshot fixture recording should stay canonically within the configured workspace `.snapshots` tree. A symlinked test snapshot directory escaping that tree should be rejected rather than used for output.

## Impact

A project containing a crafted `.snapshots/<testName>` symlink can make E2E snapshot recording overwrite JSON files outside the workspace. This can affect developer machines or CI agents that record/update snapshots for untrusted or partially trusted test repositories.
