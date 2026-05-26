# Agent harness tools file growth after stat bypasses upload size limit

## Summary

`@poe-code/agent-harness-tools` enforces `uploadMaxFileMb` using file sizes captured during directory enumeration, but reads file contents afterward and uploads those later bytes without rechecking their actual size. If a file grows between `stat()` and `readFile()`, an oversized payload can be transferred despite the configured upload limit and without being reported as skipped.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

describe("upload max-size check after file growth", () => {
  it("uploads content that exceeds the configured limit after stat", async () => {
    const local = createFsFromVolume(Volume.fromJSON({ "/repo/growing.bin": "small" }, "/")).promises as unknown as WorkspaceTransferFileSystem;
    const remote = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as WorkspaceTransferFileSystem;
    const originalReadFile = local.readFile.bind(local);
    let changed = false;
    const racingLocal = {
      ...local,
      async readFile(filePath: string, encoding?: BufferEncoding) {
        if (filePath === "/repo/growing.bin" && !changed) {
          changed = true;
          await local.writeFile(filePath, Buffer.alloc(20, "x"));
        }
        return encoding ? originalReadFile(filePath, encoding) : originalReadFile(filePath);
      }
    } as WorkspaceTransferFileSystem;
    const env: WorkspaceTransferEnv = { cwd: "/repo", uploadDir: "/upload", workspaceDir: "/workspace", fs: racingLocal, remoteFs: remote };

    const result = await uploadWorkspace(env, { uploadMaxFileMb: 0.00001 });

    expect(result.skipped).toEqual([]);
    await expect(remote.readFile("/workspace/growing.bin")).resolves.toHaveLength(20);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > upload max-size check after file growth > uploads content that exceeds the configured limit after stat
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`listFiles()` captures `stats.size` into each file entry during traversal at `packages/agent-harness-tools/src/workspace-transfer.ts:220` through `packages/agent-harness-tools/src/workspace-transfer.ts:248`. Later, `uploadWorkspace()` reads the possibly changed content at `packages/agent-harness-tools/src/workspace-transfer.ts:93` through `packages/agent-harness-tools/src/workspace-transfer.ts:98`, but compares the stale `file.bytes` value against `maxBytes` at `packages/agent-harness-tools/src/workspace-transfer.ts:108` through `packages/agent-harness-tools/src/workspace-transfer.ts:112` and writes `entry.content` at `packages/agent-harness-tools/src/workspace-transfer.ts:121` through `packages/agent-harness-tools/src/workspace-transfer.ts:137`. In the probe, a file measured as five bytes expands to twenty bytes before its content read; with a roughly ten-byte limit, the twenty-byte file is uploaded and `skipped` remains empty.

## Expected Behavior

The upload-size limit should apply to the exact bytes sent to the remote workspace. The implementation should check the loaded buffer size, read from a stable snapshot, or otherwise prevent file changes during transfer from bypassing configured limits.

## Impact

Files growing concurrently during sync can exceed bandwidth, storage, or security limits configured for remote execution while callers are told no file was skipped. Generated artifacts, logs, databases, or secrets that appear small during enumeration can be transferred after becoming arbitrarily larger, undermining upload policy enforcement.
