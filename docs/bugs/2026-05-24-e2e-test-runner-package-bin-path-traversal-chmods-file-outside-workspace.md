# E2E test runner follows package-bin path traversal and chmods a file outside the workspace

## Summary

`@poe-code/e2e-test-runner` preflight reads the selected workspace's root `package.json` and resolves its `bin` paths without requiring them to stay inside that workspace. A `bin` entry such as `../outside-tool` causes normal container startup to change an external file's permissions to executable.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-bin-traversal-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside-tool");
   await fs.mkdir(project, { recursive: true });
   await fs.writeFile(outside, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
   await fs.writeFile(
     path.join(project, "package.json"),
     JSON.stringify({ name: "probe", bin: { probe: "../outside-tool" } }),
     "utf8"
   );

   setWorkspaceDir(project);
   process.env.POE_API_KEY = "fake";
   const container = await createHostContainer({}, () => ({ bin: "true", args: [] }));
   try {
     await container.exec("true");
   } finally {
     await container.destroy();
   }

   console.log(((await fs.stat(outside)).mode & 0o777).toString(8));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The external file begins with mode `0600` and ends with mode `0755` after `container.exec()` triggers preflight. No executable file exists inside the disposable workspace; the chmod applies directly to the traversed target outside it.

`linkRootPackageBins()` obtains `relPath` from workspace-controlled `package.json`, resolves it with `resolve(repoDir, relPath)`, and executes `chmod(target, 0o755)` in `packages/e2e-test-runner/src/host-container.ts:191`. The function is invoked by preflight in `packages/e2e-test-runner/src/host-container.ts:219` without validating target containment.

## Expected Behavior

Preflight should only alter permissions for package binaries canonically located inside the selected workspace, or reject `bin` paths that escape the workspace root.

## Impact

A crafted project's `package.json` can make routine E2E container startup modify permissions on arbitrary accessible files outside the workspace. This is an externally observable filesystem mutation and can enable later execution of files that were intentionally non-executable.
