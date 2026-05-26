# Agent Harness Workspace Download Failed Write Corrupts Retained Local File

## Summary

The exported `downloadWorkspace()` synchronizer replaces an existing local workspace file by writing remote bytes directly to the live path. If the write fails after committing a prefix, the sync rejects but the user's prior local file is already corrupted.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";

import {
  downloadWorkspace,
  uploadWorkspace,
  type WorkspaceTransferEnv,
  type WorkspaceTransferFileSystem
} from "./workspace-transfer.js";

function createFs(files: Record<string, string | Buffer>): WorkspaceTransferFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as WorkspaceTransferFileSystem;
}

it("corrupts a previously retained local file when a download write fails", async () => {
  const backingLocal = createFs({ "/repo/app.ts": "base content" });
  let failWrite = false;
  const localFs: WorkspaceTransferFileSystem = {
    ...backingLocal,
    async writeFile(filePath, content) {
      if (failWrite && filePath === "/repo/app.ts") {
        await backingLocal.writeFile(filePath, Buffer.from(content).subarray(0, 3));
        throw new Error("disk full");
      }
      await backingLocal.writeFile(filePath, content);
    }
  };
  const env: WorkspaceTransferEnv = {
    cwd: "/repo",
    uploadDir: "/upload",
    workspaceDir: "/workspace",
    fs: localFs,
    remoteFs: createFs({})
  };

  await uploadWorkspace(env, {});
  await env.remoteFs!.writeFile("/workspace/app.ts", "remote content");
  failWrite = true;

  await expect(downloadWorkspace(env, { conflictPolicy: "refuse" })).rejects.toThrow("disk full");
  await expect(backingLocal.readFile("/repo/app.ts", "utf8")).resolves.toBe("rem");
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > corrupts a previously retained local file when a download write fails
```

Remove the disposable probe after validation.

## Observed Behavior

`downloadWorkspace()` reads remote file content, checks download conflicts, and then directly invokes `localFs.writeFile(localPath, remoteContent)` on the existing local path at `packages/agent-harness-tools/src/workspace-transfer.ts:155` through `packages/agent-harness-tools/src/workspace-transfer.ts:179`. In the probe, `/repo/app.ts` originally contains `base content`, the remote workspace contains `remote content`, and the injected local writer persists the first three remote bytes before rejecting. `downloadWorkspace()` rejects with `disk full`, but `/repo/app.ts` now contains only `rem` instead of the prior local contents.

## Expected Behavior

Downloading a changed remote file should either atomically commit the complete new content or leave the pre-download local file intact when persistence fails. A failed workspace synchronization must not destroy the only retained local copy of a file.

## Impact

Transient disk, quota, permission, or filesystem errors during agent workspace synchronization can corrupt user source files while reporting only a failed download operation. This can destroy both the user's original local content and the complete remote result, turning a recoverable sync failure into silent workspace data loss.
