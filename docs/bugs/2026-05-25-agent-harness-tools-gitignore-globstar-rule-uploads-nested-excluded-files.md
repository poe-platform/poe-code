# Agent harness tools gitignore globstar rule uploads nested excluded files

## Summary

`@poe-code/agent-harness-tools` claims to apply `.gitignore` filtering before transferring a workspace, but its custom ignore matcher does not implement globstar directory semantics. A normal ignore rule such as `**/.env` fails to match deeply nested `.env` files, so files excluded by Git are still uploaded into the remote execution workspace.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("gitignore globstar upload filtering", () => {
  it("uploads a deeply nested file excluded by a globstar pattern", async () => {
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({
        "/repo/.gitignore": "**/.env\n",
        "/repo/packages/app/config/.env": "TOKEN=secret\n"
      }),
      remoteFs: createFs({})
    };

    await uploadWorkspace(env, {});

    await expect(env.remoteFs!.readFile("/workspace/packages/app/config/.env", "utf8"))
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
✓ packages/agent-harness-tools/src/__probe__.test.ts > gitignore globstar upload filtering > uploads a deeply nested file excluded by a globstar pattern
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` reads `.gitignore` and applies `isIgnoredByGit()` before assembling its upload entries at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:119`. The custom rule parser and matcher classify a pattern containing `/` as a fixed path-segment comparison and require the number of file and pattern segments to be identical at `packages/agent-harness-tools/src/workspace-transfer.ts:250` through `packages/agent-harness-tools/src/workspace-transfer.ts:361`. Therefore `**/.env` has two segments and does not match `packages/app/config/.env`, which has four segments. The probe confirms that the ignored nested secret is present at `/workspace/packages/app/config/.env` after upload.

## Expected Behavior

Workspace upload should honor standard `.gitignore` matching semantics, including globstar patterns that exclude matching descendants at arbitrary nesting depth. A file ignored by Git under `**/.env` should never be included in remote transfer.

## Impact

Projects commonly use globstar rules for nested credentials, generated state, dependency artifacts, and local configuration across monorepo packages. These files can be copied into remote sandboxes despite being excluded from version control and expected transfer boundaries, exposing secrets or increasing execution payloads without warning.
