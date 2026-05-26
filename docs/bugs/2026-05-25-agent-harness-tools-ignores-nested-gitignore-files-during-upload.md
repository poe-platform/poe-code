# Agent harness tools ignores nested gitignore files during upload

## Summary

`@poe-code/agent-harness-tools` reads only the `.gitignore` file at the workspace root before uploading files. Git applies additional `.gitignore` files in descendant directories, but those rules are never loaded during recursive transfer traversal. A secret excluded by its nearest package-level `.gitignore` is therefore copied into the remote execution workspace.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { uploadWorkspace, type WorkspaceTransferEnv, type WorkspaceTransferFileSystem } from "./workspace-transfer.js";

function createFs(files: Record<string, string>) {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as WorkspaceTransferFileSystem;
}

describe("nested gitignore workspace upload", () => {
  it("uploads a file excluded by its nearest directory gitignore", async () => {
    const env: WorkspaceTransferEnv = {
      cwd: "/repo",
      uploadDir: "/upload",
      workspaceDir: "/workspace",
      fs: createFs({
        "/repo/packages/app/.gitignore": ".env\n",
        "/repo/packages/app/.env": "TOKEN=secret\n"
      }),
      remoteFs: createFs({})
    };

    await uploadWorkspace(env, {});

    await expect(env.remoteFs!.readFile("/workspace/packages/app/.env", "utf8"))
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
✓ packages/agent-harness-tools/src/__probe__.test.ts > nested gitignore workspace upload > uploads a file excluded by its nearest directory gitignore
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`uploadWorkspace()` loads ignore rules exactly once from `path.join(env.cwd, ".gitignore")` at `packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:105`. Its recursive `listFiles()` traversal enumerates descendant files, including descendant `.gitignore` documents, without loading or associating rules from those directories at `packages/agent-harness-tools/src/workspace-transfer.ts:220` through `packages/agent-harness-tools/src/workspace-transfer.ts:246`. In the probe, `/repo/packages/app/.gitignore` excludes `.env`, but `/workspace/packages/app/.env` is written with the secret content after upload.

## Expected Behavior

Workspace synchronization that claims `.gitignore` filtering should apply the same hierarchical ignore sources Git uses, including nested `.gitignore` files relative to their containing directory. A file excluded by a package-local ignore rule must not be transferred remotely.

## Impact

Monorepos and generated package trees commonly keep package-specific credentials, fixture outputs, build caches, and environment files out of version control using nested ignore files. Remote agents can unexpectedly receive those local-only files even when developers verified that Git ignores them, creating secret-exposure and excessive-upload risk distinct from unsupported pattern matching in a loaded root rule.
