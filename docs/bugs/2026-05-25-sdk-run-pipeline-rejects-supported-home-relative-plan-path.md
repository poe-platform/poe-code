# SDK `runPipeline` Rejects Supported Home-Relative Plan Path

## Summary

The pipeline core supports explicit plan paths beginning with `~/` by resolving them below `homeDir`, but the public SDK `runPipeline()` auto-initialization preflight resolves the same string with `path.resolve(cwd, plan)`. A valid home-relative pipeline plan therefore fails with `ENOENT` in the SDK before the core receives it.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { fs, vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

const workspaceRunPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});
vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));
vi.mock("@poe-code/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/pipeline")>();
  return { ...actual, runPipeline: workspaceRunPipelineMock };
});

import { runPipeline } from "./pipeline.js";

describe("SDK pipeline home-relative explicit plan", () => {
  it("resolves a supported tilde path under cwd instead of homeDir during preflight", async () => {
    vol.reset();
    vol.fromJSON({
      "/home/test/plans/feature.md": ["---", "kind: pipeline", "version: 1", "tasks:", "  - id: work", "    title: Work", "    prompt: Do it", "    status: open", "---", ""].join("\n")
    }, "/");

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "~/plans/feature.md",
      runAgent: vi.fn()
    })).rejects.toMatchObject({ code: "ENOENT" });

    expect(workspaceRunPipelineMock).not.toHaveBeenCalled();
    await expect(fs.promises.readFile("/home/test/plans/feature.md", "utf8")).resolves.toContain("tasks:");
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/sdk/__probe__.test.ts > SDK pipeline home-relative explicit plan > resolves a supported tilde path under cwd instead of homeDir during preflight
```

## Observed Behavior

The core path resolver intentionally maps `~/...` to `homeDir` in `packages/pipeline/src/plan/discovery.ts:111` through `packages/pipeline/src/plan/discovery.ts:116`. The SDK preflight does not reuse that behavior: `src/sdk/pipeline.ts:123` through `src/sdk/pipeline.ts:125` derives `planAbsolutePath` with `path.resolve(options.cwd, options.plan)` before calling `planNeedsInit()`. For `plan: "~/plans/feature.md"` and `cwd: "/repo"`, it inspects a literal path beneath `/repo` rather than the existing file under `/home/test`, rejects `ENOENT`, and never invokes the core runner.

## Expected Behavior

The public SDK should preserve the pipeline core's explicit-path contract, including home-relative `~/` paths, when performing initialization preflight. It should resolve the plan with `homeDir` semantics before reading or delegate path resolution entirely to the core.

## Impact

SDK and CLI code paths that specify pipeline plans under user-level plan directories cannot run valid `~/` documents even though the exported core API supports them. Users receive incorrect missing-file errors and cannot use the same plan locator consistently across pipeline entry points.
