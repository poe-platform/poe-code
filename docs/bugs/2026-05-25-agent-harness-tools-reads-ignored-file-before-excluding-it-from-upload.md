# Agent harness tools reads ignored file before excluding it from upload

## Summary

`@poe-code/agent-harness-tools` loads the contents of every enumerated local file before applying `.gitignore`, `.poe-code-ignore`, or configured workspace-exclude rules. As a result, a file that is deliberately excluded from remote transfer can still make the entire upload fail if it cannot be read, even though its bytes would never be included in the uploaded workspace.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

describe("ignored unreadable file upload", () => {
  it("rejects while reading a gitignored file that would never be uploaded", async () => {
    const backing = createFsFromVolume(Volume.fromJSON({
      "/repo/.gitignore": "secret.txt\n",
      "/repo/app.ts": "app",
      "/repo/secret.txt": "secret"
    }, "/")).promises as unknown as WorkspaceTransferFileSystem;
    const local = {
      ...backing,
      async readFile(filePath: string, encoding?: BufferEncoding) {
        if (filePath === "/repo/secret.txt") throw new Error("permission denied reading ignored secret");
        return encoding ? backing.readFile(filePath, encoding) : backing.readFile(filePath);
      }
    } as WorkspaceTransferFileSystem;
    const remote = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as WorkspaceTransferFileSystem;
    const env: WorkspaceTransferEnv = { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs: local, remoteFs: remote };

    await expect(uploadWorkspace(env, {})).rejects.toThrow("permission denied reading ignored secret");
    await expect(remote.readFile("/workspace/app.ts", "utf8")).rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > ignored unreadable file upload > rejects while reading a gitignored file that would never be uploaded
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` enumerates local files and enters its processing loop at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:93`. Inside that loop it immediately calls `localFs.readFile(file.absolutePath)` and hashes the returned buffer at `packages/agent-harness-tools/src/workspace-transfer.ts:94` through `packages/agent-harness-tools/src/workspace-transfer.ts:98`; only afterward does it check whether the path is excluded at `packages/agent-harness-tools/src/workspace-transfer.ts:100` through `packages/agent-harness-tools/src/workspace-transfer.ts:105`. In the probe, `secret.txt` is root-gitignored and would not be transferred, but a read rejection for that local-only file rejects `uploadWorkspace()` before even the allowed `app.ts` is uploaded.

## Expected Behavior

Paths that are excluded from upload should be filtered before their contents are opened, hashed, or otherwise required for a successful remote transfer unless the API explicitly needs them for a separate documented purpose. An unreadable ignored file should not prevent uploading permitted workspace files.

## Impact

Permission-restricted credentials, local sockets represented through adapters, locked generated files, or other ignored local-only paths can block all remote execution even though users excluded them precisely to keep them outside the transfer. This also unnecessarily touches ignored data during sync, expanding the local access surface beyond the bytes needed for the uploaded workspace.
