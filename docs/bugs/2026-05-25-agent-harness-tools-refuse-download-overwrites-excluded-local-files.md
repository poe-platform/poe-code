# Agent harness tools refuse download overwrites excluded local files

## Summary

`@poe-code/agent-harness-tools` omits gitignored and explicitly excluded local files from workspace upload, but still records their local hashes as download baselines. If the remote workspace later contains a file at an excluded path, `downloadWorkspace({ conflictPolicy: "refuse" })` treats the unchanged excluded local file as safe to replace and overwrites it, even though it was intentionally never sent to the remote environment.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { downloadWorkspace, uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("download over excluded local file", () => {
  it("overwrites an unchanged gitignored secret even with conflicts refused", async () => {
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({ "/repo/.gitignore": ".env\n", "/repo/.env": "LOCAL_SECRET=keep\n" }),
      remoteFs: createFs({})
    };
    await uploadWorkspace(env, {});
    await env.remoteFs!.writeFile("/workspace/.env", "LOCAL_SECRET=remote\n");

    const result = await downloadWorkspace(env, { conflictPolicy: "refuse" });

    expect(result.conflicts).toEqual([]);
    await expect(env.fs!.readFile("/repo/.env", "utf8")).resolves.toBe("LOCAL_SECRET=remote\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > download over excluded local file > overwrites an unchanged gitignored secret even with conflicts refused
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

During upload, every local file is entered into `state` before exclusion checks, with `uploaded: false` retained for `.gitignore`, `.poe-code-ignore`, workspace-excluded, or oversize paths at `packages/agent-harness-tools/src/workspace-transfer.ts:93` through `packages/agent-harness-tools/src/workspace-transfer.ts:118`. During download, a remote file at the same path is checked against the stored local hash and written when it has not changed since upload at `packages/agent-harness-tools/src/workspace-transfer.ts:155` through `packages/agent-harness-tools/src/workspace-transfer.ts:178` and `packages/agent-harness-tools/src/workspace-transfer.ts:364` through `packages/agent-harness-tools/src/workspace-transfer.ts:380`. In the probe, local `.env` is excluded and never uploaded, but a remote-created `.env` replaces its local secret contents with no reported conflict under `conflictPolicy: "refuse"`.

## Expected Behavior

Files deliberately excluded from the remote workspace should remain protected local-only paths. Download in refusal mode should reject or report a conflict before writing any remote file over an excluded local path, regardless of whether the local contents changed after upload.

## Impact

Remote agent output can silently replace excluded credential files, local environment configuration, large local-only assets, or other ignored content that users specifically chose not to synchronize. The `refuse` policy appears to protect local work while allowing modification of paths that commonly contain secrets or machine-specific configuration.
