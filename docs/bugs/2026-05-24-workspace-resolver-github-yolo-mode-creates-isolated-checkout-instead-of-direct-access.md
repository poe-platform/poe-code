# Workspace resolver GitHub yolo mode creates isolated checkout instead of direct access

## Summary

`@poe-code/workspace-resolver` documents GitHub `yolo` mode as “Direct mutable access (no isolation).” In practice, resolving a GitHub locator with `mode: "yolo"` creates the same detached git worktree and cleanup callback used for isolated editing, so callers do not receive the documented direct mutable checkout.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { fs as rawFs, vol } from "memfs";
import { resolveWorkspace } from "./resolve.js";

describe("github yolo workspace mode", () => {
  it("creates an isolated worktree instead of resolving direct mutable cache access", async () => {
    vol.reset();
    const fs = rawFs.promises as never;
    await rawFs.promises.mkdir("/home/test/.poe-code/workspaces/github/owner-repo", { recursive: true });
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        await rawFs.promises.mkdir(args[3]!, { recursive: true });
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await resolveWorkspace("github://owner/repo", {
      baseDir: "/repo",
      homeDir: "/home/test",
      mode: "yolo",
      fs,
      exec
    } as never);

    console.log(JSON.stringify({ cwd: result.cwd, hasCleanup: typeof result.cleanup === "function", calls: exec.mock.calls.map((call) => call[1]) }));
    expect(result.cwd).toContain("/checkouts/owner-repo/");
    expect(result.cleanup).toBeTypeOf("function");
    expect(exec.mock.calls.some((call) => call[1][0] === "worktree" && call[1][1] === "add")).toBe(true);
  });
});
PROBE
npm exec -- vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
rm packages/workspace-resolver/src/__probe__.test.ts
```

Representative output:

```text
{"cwd":"/home/test/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>","hasCleanup":true,"calls":[["status","--porcelain"],["pull","--ff-only"],["worktree","add","--detach","/home/test/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>","HEAD"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > github yolo workspace mode > creates an isolated worktree instead of resolving direct mutable cache access
```

## Observed Behavior

The README access-mode table states that `edit` creates an isolated writable checkout while `yolo` provides direct mutable access without isolation in `packages/workspace-resolver/README.md`. However, `resolveWorkspace()` only treats `mode === "read"` specially; every other mode invokes `createWritableCheckout()` at `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:43`. That helper creates a detached worktree under `workspaces/checkouts` and returns cleanup logic at `packages/workspace-resolver/src/github/isolation.ts:4` through `packages/workspace-resolver/src/github/isolation.ts:43`.

## Expected Behavior

For a GitHub locator in `yolo` mode, the resolver should return the directly mutable shared checkout specified by its public mode contract, without provisioning an isolated worktree or returning isolation cleanup behavior. If direct mutable GitHub access is intentionally unsupported, `yolo` should be rejected or its public documentation and type surface should not claim that behavior.

## Impact

Callers selecting `yolo` to make direct mutations against a reusable GitHub workspace instead receive disposable isolated state. Edits may be lost when cleanup runs, side effects may not appear in the expected shared checkout, and orchestration that relies on the documented difference between `edit` and `yolo` cannot behave correctly.
