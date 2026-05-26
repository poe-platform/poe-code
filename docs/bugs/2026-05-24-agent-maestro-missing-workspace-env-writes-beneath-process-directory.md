# Agent Maestro missing workspace env writes beneath process directory

## Summary

`agent-maestro` resolves an unset environment variable used for `workspace.root` to an empty string, accepts the resulting configuration during dispatch validation, and creates per-task workspaces relative to the CLI process working directory rather than beneath an intentional Maestro workspace root.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { vol } from "memfs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockTaskList } from "./__test_utils__/index.js";
import { resolveConfig } from "./config/schema.js";
import { validateDispatch } from "./config/validate.js";
import { ensureWorkspace } from "./workspace/manager.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

describe("missing workspace environment variable", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vol.reset();
  });

  it("passes validation and creates task workspaces beneath process cwd", async () => {
    delete process.env.MAESTRO_WORKSPACE_MISSING;
    const cfg = resolveConfig({
      tasks: { type: "markdown-dir", path: "/repo/tasks" },
      states: { planned: { prompt: "Plan" }, done: { terminal: true } },
      workspace: { root: "$MAESTRO_WORKSPACE_MISSING" },
      agent: { list: "tasks" }
    }, "/repo/workflows");

    const validation = await validateDispatch(cfg, createMockTaskList({ lists: ["tasks"] }));
    const workspace = await ensureWorkspace(cfg.workspace.root, "tasks/next");
    const absoluteWorkspace = path.resolve(workspace.path);

    console.log(JSON.stringify({ root: cfg.workspace.root, validation, workspace, absoluteWorkspace }));
    expect(cfg.workspace.root).toBe("");
    expect(validation).toEqual({ ok: true });
    expect(absoluteWorkspace.startsWith(process.cwd() + path.sep)).toBe(true);
    expect(vol.existsSync(absoluteWorkspace)).toBe(true);
  });
});
PROBE
npx vitest run packages/agent-maestro/src/__probe__.test.ts --reporter=verbose
rm -f packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"root":"","validation":{"ok":true},"workspace":{"path":"tasks_next-763c3cccd603fda8","createdNow":true},"absoluteWorkspace":"/Users/kjopek/Workspace/poe-code/tasks_next-763c3cccd603fda8"}
✓ packages/agent-maestro/src/__probe__.test.ts > missing workspace environment variable > passes dispatch validation and creates task workspaces beneath process cwd
```

## Observed Behavior

`resolveStringValue()` at `packages/agent-maestro/src/config/schema.ts:187` through `packages/agent-maestro/src/config/schema.ts:199` converts an unset `$MAESTRO_WORKSPACE_MISSING` reference to `""`, and `resolvePathValue()` at `packages/agent-maestro/src/config/schema.ts:201` through `packages/agent-maestro/src/config/schema.ts:209` preserves that empty path. Unlike empty task-source values, `validateDispatch()` at `packages/agent-maestro/src/config/validate.ts:51` through `packages/agent-maestro/src/config/validate.ts:88` performs no workspace-root validation and returns `{ ok: true }`. `ensureWorkspace()` at `packages/agent-maestro/src/workspace/manager.ts:12` through `packages/agent-maestro/src/workspace/manager.ts:30` then uses the empty root with `path.join()`, causing the task workspace path to be relative and therefore materialized beneath the process current working directory.

## Expected Behavior

An unresolved environment variable used as `workspace.root` should fail configuration or dispatch validation before any workspace operation occurs. Maestro should never silently reinterpret a missing configured workspace root as a relative path rooted at the invocation directory.

## Impact

A typo, absent secret/environment setting, or incomplete deployment configuration can make normal task execution create and later remove workspace directories in the directory from which Maestro was launched, including a repository checkout or other unrelated writable location. This violates workspace isolation and can pollute or delete unexpected paths during routine execution and cleanup.
