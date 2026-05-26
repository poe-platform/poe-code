# E2E test runner follows a symlinked package binary and chmods a file outside the workspace

## Summary

`@poe-code/e2e-test-runner` preflight follows a workspace-local package binary symlink when making root package binaries executable. A `package.json` `bin` target that appears inside the workspace but is a symlink can redirect `chmod(0o755)` to an external file.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-bin-symlink-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside-tool");
   await fs.mkdir(path.join(project, "bin"), { recursive: true });
   await fs.writeFile(outside, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
   await fs.symlink(outside, path.join(project, "bin", "probe"));
   await fs.writeFile(
     path.join(project, "package.json"),
     JSON.stringify({ name: "probe", bin: { probe: "bin/probe" } }),
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

The workspace `bin/probe` path is a symlink to an external file created with mode `0600`. After `container.exec()` triggers preflight, the external target's mode is `0755`, showing that preflight follows the symlink while preparing package bins.

`linkRootPackageBins()` processes the normal-looking `bin/probe` path from `package.json`, then calls `access(target)` and `chmod(target, 0o755)` in `packages/e2e-test-runner/src/host-container.ts:191`. It does not resolve and validate the canonical binary target before mutating it.

## Expected Behavior

Preparing workspace binaries should not change permissions on external files reached through workspace symlinks. Preflight should reject escaping symlink targets or safely confine mutations to the selected workspace.

## Impact

A crafted workspace can use an ordinary package-bin symlink to make E2E startup chmod arbitrary external files executable. This exposes host state to mutation during automated test execution even when the declared package bin path remains lexically inside the workspace.
