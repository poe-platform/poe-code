# Agent harness tools gitignore trims significant leading space and excludes wrong file

## Summary

`@poe-code/agent-harness-tools` calls `trim()` on each `.gitignore` rule before matching it. Git ignore patterns can contain significant leading spaces, so a rule intended to exclude a file whose name begins with a space is rewritten to target a different non-space-prefixed path. The intended ignored file is uploaded while an allowed sibling file is suppressed instead.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("leading-space gitignore rule", () => {
  it("excludes the wrong path after trimming a significant leading space", async () => {
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({
        "/repo/.gitignore": " secret.txt\n",
        "/repo/ secret.txt": "intended ignored\n",
        "/repo/secret.txt": "should upload\n"
      }),
      remoteFs: createFs({})
    };

    await uploadWorkspace(env, {});

    await expect(env.remoteFs!.readFile("/workspace/ secret.txt", "utf8"))
      .resolves.toBe("intended ignored\n");
    await expect(env.remoteFs!.readFile("/workspace/secret.txt", "utf8"))
      .rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > leading-space gitignore rule > excludes the wrong path after trimming a significant leading space
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` reads root `.gitignore` rules and invokes `isIgnoredByGit()` before collecting upload entries at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:119`. `parseIgnoreLines()` applies `rawLine.trim()` before it records the rule at `packages/agent-harness-tools/src/workspace-transfer.ts:261` through `packages/agent-harness-tools/src/workspace-transfer.ts:284`. In the probe, the rule ` secret.txt` is reduced to `secret.txt`: the local file named ` secret.txt` is copied to `/workspace/ secret.txt`, while the unrelated `secret.txt` file is omitted from the upload.

## Expected Behavior

Workspace transfer should preserve leading spaces that are part of a `.gitignore` pattern and apply the exclusion to the intended path. Parsing a rule must not transform it into a different path rule that hides an allowed file while uploading the originally ignored one.

## Impact

Repositories containing space-prefixed generated files, exported data, or sensitive local artifacts can leak those files into remote execution workspaces while unexpectedly omitting legitimate similarly named files. The false exclusion also obscures the leak because returned upload contents differ from the project's Git ignore behavior in both directions.
