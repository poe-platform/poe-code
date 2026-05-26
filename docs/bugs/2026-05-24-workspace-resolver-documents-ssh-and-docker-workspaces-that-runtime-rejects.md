# Workspace resolver documents SSH and Docker workspaces that runtime rejects

## Summary

The public `@poe-code/workspace-resolver` README describes `ssh://` and `docker://` locators as supported workspace backends with remote execution and synchronization behavior. The exported parser recognizes both schemes, but `resolveWorkspace()` unconditionally rejects both of them as unsupported. Users following the published package documentation cannot resolve either documented remote workspace type.

## Reproduction

From the repository root, run a disposable Vitest probe that passes the README's representative SSH and Docker locators through the exported resolution path:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolve.js";
import type { ResolverFileSystem } from "./types.js";
describe("documented remote workspace locator resolution", () => {
  it("rejects both documented ssh and docker locators as unsupported", async () => {
    const fs = createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
    const options = {
      baseDir: "/repo", homeDir: "/home/test", fs,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    };
    const outcomes = await Promise.all(
      ["ssh://git@example.com/worktree", "docker://dev-container/workspace"].map(async (locator) => {
        try {
          await resolveWorkspace(locator, options);
          return { locator, resolved: true };
        } catch (error) {
          return { locator, rejected: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    console.log(JSON.stringify(outcomes));
    expect(outcomes).toEqual([
      { locator: "ssh://git@example.com/worktree", rejected: 'Unsupported workspace locator scheme "ssh".' },
      { locator: "docker://dev-container/workspace", rejected: 'Unsupported workspace locator scheme "docker".' },
    ]);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/README.md | sed -n '47,80p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '7,25p'
nl -ba packages/workspace-resolver/src/workspace-resolver.test.ts | sed -n '160,173p'
```

## Observed Behavior

Both locators shown as operational workspace backends in the README reject immediately from the exported resolver:

```text
[{"locator":"ssh://git@example.com/worktree","rejected":"Unsupported workspace locator scheme \"ssh\"."},{"locator":"docker://dev-container/workspace","rejected":"Unsupported workspace locator scheme \"docker\"."}]
✓ packages/workspace-resolver/src/__probe__.test.ts > documented remote workspace locator resolution > rejects both documented ssh and docker locators as unsupported
```

The README states that SSH workspaces run the agent on the remote host with synchronization and that Docker workspaces run the agent inside the container with synchronization in `packages/workspace-resolver/README.md:47` through `packages/workspace-resolver/README.md:80`. However, `resolveWorkspace()` throws for either parsed scheme in `packages/workspace-resolver/src/resolve.ts:7` through `packages/workspace-resolver/src/resolve.ts:25`, and the existing parser test labels these locators as reserved for future support in `packages/workspace-resolver/src/workspace-resolver.test.ts:160` through `packages/workspace-resolver/src/workspace-resolver.test.ts:173`.

## Expected Behavior

Public documentation should advertise only executable locator backends. Either SSH and Docker resolution must implement the described behavior, or the README and exported/type-visible surface should clearly state that these schemes are parsed placeholders and not supported runtime workspaces.

## Impact

Users configuring remote SSH or Docker agent workspaces from the package documentation encounter immediate runtime failures despite supplying documented syntax. This blocks promised remote-workspace workflows and can waste setup effort or cause automation deployment failures when unsupported backends are assumed to be available.
