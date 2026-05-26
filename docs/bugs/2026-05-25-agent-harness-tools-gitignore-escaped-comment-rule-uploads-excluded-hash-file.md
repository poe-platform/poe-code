# Agent harness tools gitignore escaped comment rule uploads excluded hash file

## Summary

`@poe-code/agent-harness-tools` does not interpret Git's escaped leading comment marker syntax in `.gitignore` rules. A root rule such as `\#credentials`, which is intended to exclude a literal file named `#credentials`, is treated as a backslash-prefixed pattern and fails to match the file. The excluded file is uploaded into the remote workspace.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("escaped comment gitignore rule", () => {
  it("uploads a hash-prefixed file ignored by an escaped rule", async () => {
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({
        "/repo/.gitignore": "\\#credentials\n",
        "/repo/#credentials": "TOKEN=secret\n"
      }),
      remoteFs: createFs({})
    };

    await uploadWorkspace(env, {});

    await expect(env.remoteFs!.readFile("/workspace/#credentials", "utf8"))
      .resolves.toBe("TOKEN=secret\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > escaped comment gitignore rule > uploads a hash-prefixed file ignored by an escaped rule
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` loads root `.gitignore` content through `readIgnoreFile()` and filters each path via `isIgnoredByGit()` at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:105`. `parseIgnoreLines()` trims each input and treats only lines literally beginning with `#` as comments, but does not unescape a leading `\#` marker before storing the rule at `packages/agent-harness-tools/src/workspace-transfer.ts:261` through `packages/agent-harness-tools/src/workspace-transfer.ts:284`. The resulting pattern is `\#credentials`, which never matches the actual file path `#credentials`, and the probe confirms its secret content is written to the remote workspace.

## Expected Behavior

Workspace transfer should honor standard Git ignore syntax for escaped leading comment markers. A `.gitignore` entry of `\#credentials` must match the literal file `#credentials` and keep it out of uploaded workspace content.

## Impact

Repositories can intentionally ignore hash-prefixed credential, scratch, or generated files using ordinary Git syntax while remote agent transfers silently include them. This creates an exposure path even for root-level ignore files whose rule location is supported, independent of the separate unsupported globstar and nested-ignore-source defects.
