# Agent Harness Workspace Upload Failure Destroys Prior Remote Workspace

## Summary

The exported `uploadWorkspace()` deletes the entire existing remote workspace before it writes a replacement archive and replacement files. If any replacement file write fails, the upload rejects after the previous usable remote workspace has already been deleted and partially replaced.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";

import {
  uploadWorkspace,
  type WorkspaceTransferEnv,
  type WorkspaceTransferFileSystem
} from "./workspace-transfer.js";

function createFs(files: Record<string, string | Buffer>): WorkspaceTransferFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as WorkspaceTransferFileSystem;
}

it("destroys the prior remote workspace before a replacement upload completes", async () => {
  const localFs = createFs({ "/repo/app.ts": "fresh content" });
  const backingRemote = createFs({ "/workspace/app.ts": "stable remote", "/workspace/keep.ts": "keep" });
  const remoteFs: WorkspaceTransferFileSystem = {
    ...backingRemote,
    async writeFile(filePath, content) {
      if (filePath === "/workspace/app.ts") {
        await backingRemote.writeFile(filePath, Buffer.from(content).subarray(0, 5));
        throw new Error("remote disk full");
      }
      await backingRemote.writeFile(filePath, content);
    }
  };
  const env: WorkspaceTransferEnv = {
    cwd: "/repo",
    uploadDir: "/upload",
    workspaceDir: "/workspace",
    fs: localFs,
    remoteFs
  };

  await expect(uploadWorkspace(env, {})).rejects.toThrow("remote disk full");
  await expect(backingRemote.readFile("/workspace/app.ts", "utf8")).resolves.toBe("fresh");
  await expect(backingRemote.readFile("/workspace/keep.ts", "utf8")).rejects.toThrow();
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > destroys the prior remote workspace before a replacement upload completes
```

Remove the disposable probe after validation.

## Observed Behavior

`uploadWorkspace()` constructs replacement entries, then removes the current remote workspace tree before creating and writing the new one at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:132`. In the probe, the remote workspace initially contains a usable `app.ts` with `stable remote` plus `keep.ts`. The replacement write for `app.ts` commits only `fresh` and rejects with `remote disk full`; after the rejected upload, `keep.ts` is already gone and `app.ts` is only a partial replacement.

## Expected Behavior

A replacement workspace upload should stage a complete new remote workspace before committing it, or preserve the prior remote workspace when any replacement operation fails. An upload failure should not destroy the last coherent remote execution state.

## Impact

Any transient failure while resynchronizing an agent environment can erase previously uploaded remote files and leave a corrupt partial workspace. Subsequent remote commands cannot continue from the prior stable environment, and retries may operate on incomplete state rather than reporting a recoverable upload failure.
