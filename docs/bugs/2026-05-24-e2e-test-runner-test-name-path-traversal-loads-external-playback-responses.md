# E2E test runner accepts test-name path traversal and loads external playback responses

## Summary

`@poe-code/e2e-test-runner` uses unvalidated `ContainerOptions.testName` when locating playback snapshots beneath `.snapshots`. A traversal value such as `../../outside` causes proxy playback to read response fixtures outside the configured workspace without needing any symlink.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import { createHash } from "node:crypto";
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { createHostContainer } from "./packages/e2e-test-runner/src/host-container.ts";
   import { setWorkspaceDir } from "./packages/e2e-test-runner/src/runtime.ts";

   const requestBody = {
     model: "test-model",
     messages: [{ role: "user", content: "probe" }]
   };
   const key = `test-model-${createHash("sha256")
     .update(JSON.stringify(requestBody))
     .digest("hex")
     .slice(0, 12)}`;
   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-playback-traversal-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");

   await fs.mkdir(project, { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(
     path.join(outside, `${key}.json`),
     JSON.stringify({ key, response: { traversedRead: true } }),
     "utf8"
   );

   setWorkspaceDir(project);
   process.env.POE_API_KEY = "fake";
   const container = await createHostContainer(
     { useSnapshots: true, testName: "../../outside" },
     () => ({ bin: "true", args: [] })
   );

   try {
     await container.exec("true");
     const url = (await container.proxyLog())!.match(/http:\/\/[^ ]+/)![0];
     const response = await fetch(`${url}/v1/chat/completions`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify(requestBody)
     });
     console.log(response.status, await response.json());
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The proxied playback request returns HTTP `200` with `{ "traversedRead": true }`, which was stored at `outside/<derived-key>.json` rather than beneath `project/.snapshots`. `createHostContainer()` accepts the traversal-bearing test name without error.

`createHostContainer()` forms `snapshotDir` using `resolve(repoDir, E2E_FIXTURES_DIR, options.testName)` in `packages/e2e-test-runner/src/host-container.ts:285`. Playback passes this directory into `readSnapshotResponse()`, which reads the derived fixture path directly in `packages/e2e-test-runner/src/proxy-server.ts:145` after key derivation in `packages/e2e-test-runner/src/proxy-server.ts:78`.

## Expected Behavior

`testName` should be confined to a safe directory identifier, and playback should only load snapshots canonically contained inside the selected workspace `.snapshots` directory.

## Impact

A caller able to control a test name can inject arbitrary external fixture responses into E2E proxy playback. This can manipulate tests or agent executions and bypasses the intended workspace-local fixture boundary without any filesystem symlink setup.
