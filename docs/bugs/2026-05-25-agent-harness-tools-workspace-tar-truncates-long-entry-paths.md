# Agent harness tools workspace tar truncates long entry paths

## Summary

`@poe-code/agent-harness-tools` writes a `workspace.tar` archive during upload using a hand-built USTAR header whose filename field is fixed at 100 bytes. File paths longer than that limit are silently truncated in the archive rather than represented with a USTAR prefix or rejected, even while the separate remote workspace copy is written at the full original path. The upload therefore produces two inconsistent representations of the same workspace.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("workspace tar long path", () => {
  it("stores a truncated archive name while the workspace copy uses the full path", async () => {
    const longName = `${"segment/".repeat(13)}file.txt`;
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({ [`/repo/${longName}`]: "content" }),
      remoteFs: createFs({})
    };

    await uploadWorkspace(env, {});

    const tar = await env.remoteFs!.readFile("/upload/workspace.tar");
    const archivedName = tar.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    expect(archivedName).toBe(longName.slice(0, 100));
    expect(archivedName).not.toBe(longName);
    await expect(env.remoteFs!.readFile(`/workspace/${longName}`, "utf8")).resolves.toBe("content");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > workspace tar long path > stores a truncated archive name while the workspace copy uses the full path
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` writes both the generated archive and the individually materialized workspace entries at `packages/agent-harness-tools/src/workspace-transfer.ts:121` through `packages/agent-harness-tools/src/workspace-transfer.ts:132`. `createTar()` passes every relative path to `createTarHeader()` at `packages/agent-harness-tools/src/workspace-transfer.ts:445` through `packages/agent-harness-tools/src/workspace-transfer.ts:469`, and `writeString()` copies at most the first 100 UTF-8 bytes into the archive filename field at `packages/agent-harness-tools/src/workspace-transfer.ts:472` through `packages/agent-harness-tools/src/workspace-transfer.ts:475`. In the probe, the full path exists below `/workspace`, but the corresponding tar header contains only its first 100 bytes.

## Expected Behavior

The uploaded archive should represent exactly the same set of file paths as the uploaded workspace tree. Paths exceeding the direct USTAR name field should be encoded through supported long-path mechanisms or rejected before a successful upload result is returned; they must not be silently renamed by truncation.

## Impact

Consumers of the exported upload archive can extract files under wrong truncated names, collide distinct long paths into one apparent archive destination, or fail to reproduce the workspace used for execution. Long monorepo paths and generated fixture trees can therefore produce successful-looking uploads whose archived transfer artifact is corrupt and inconsistent with the live remote filesystem.
