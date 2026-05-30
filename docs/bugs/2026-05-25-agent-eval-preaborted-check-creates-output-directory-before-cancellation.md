---
name: "Agent eval pre-aborted check creates output directory before cancellation"
---

# Agent eval pre-aborted check creates output directory before cancellation

## Summary

`@poe-code/agent-eval` publicly accepts an `AbortSignal` for `evalCheck()`, but the check entrypoint creates its timestamped output directory before it reaches the first abort-aware operation. A request whose signal is already aborted when submitted still mutates the configured evaluation output tree, then rejects only when `cloneTarget()` observes the cancellation.

## Reproduction

Add the following temporary probe as `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  cloneTarget: vi.fn(async (input: { signal?: AbortSignal }) => {
    if (input.signal?.aborted) {
      throw Object.assign(new Error("already aborted"), { name: "AbortError" });
    }
  })
}));

vi.mock("node:fs/promises", () => ({
  cp: vi.fn(async () => undefined),
  mkdir: mocks.mkdir,
  stat: vi.fn(async () => ({ isDirectory: () => false }))
}));
vi.mock("./source/open.js", () => ({ openSource: vi.fn(async () => ({ rootDir: "/source" })) }));
vi.mock("./source/registry.js", () => ({
  loadEval: vi.fn(async () => ({ target: { repo: "repo", ref: "main" }, oracle: { path: "oracle", solutionDest: "src" } }))
}));
vi.mock("./source/config.js", () => ({ loadSourceConfig: vi.fn(async () => ({ out: "out" })) }));
vi.mock("./run/clone.js", () => ({ cloneTarget: mocks.cloneTarget }));
vi.mock("./run/scorer.js", () => ({ runScorer: vi.fn() }));

import { evalCheck } from "./check/check.js";

describe("pre-aborted evalCheck", () => {
  it("creates the output directory before the abortable clone rejects", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(evalCheck({ sourceDir: "/source", evalId: "task", signal: controller.signal })).rejects.toThrow("already aborted");

    console.log(JSON.stringify({ mkdirCalls: mocks.mkdir.mock.calls, cloneCalls: mocks.cloneTarget.mock.calls.length }));
    expect(mocks.mkdir).toHaveBeenCalledTimes(1);
    expect(mocks.cloneTarget).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm packages/agent-eval/src/__probe__.test.ts
nl -ba packages/agent-eval/src/check/check.ts | sed -n '10,37p'
nl -ba packages/agent-eval/src/run/clone.ts | sed -n '14,16p;85,91p'
```

The reproduction passes and shows the directory creation occurring before cancellation is raised:

```text
{"mkdirCalls":[["/source/out/.check/task/2026-05-25T07-00-36-727Z",{"recursive":true}]],"cloneCalls":1}
✓ packages/agent-eval/src/__probe__.test.ts > pre-aborted evalCheck > creates the output directory before the abortable clone rejects
```

## Observed Behavior

`evalCheck()` exposes `signal?: AbortSignal` in `packages/agent-eval/src/check/check.ts:10` through `packages/agent-eval/src/check/check.ts:14`, resolves its output path, and calls `mkdir(path.dirname(cloneDir), { recursive: true })` at `packages/agent-eval/src/check/check.ts:23` through `packages/agent-eval/src/check/check.ts:32` before invoking `cloneTarget()` with that signal. `cloneTarget()` does perform an immediate abort check at `packages/agent-eval/src/run/clone.ts:14` through `packages/agent-eval/src/run/clone.ts:16` and `packages/agent-eval/src/run/clone.ts:85` through `packages/agent-eval/src/run/clone.ts:91`, but by then `evalCheck()` has already persisted a new timestamped directory for an operation cancelled before it began.

## Expected Behavior

When a supplied signal is already aborted, `evalCheck()` should reject before creating run directories or otherwise changing the output tree. A pre-cancelled check request should be side-effect free.

## Impact

Cancelled checks invoked from automation, UI cancellation, or batch control paths leave behind empty `.check` run directories even though no evaluation was permitted to start. Repeated pre-cancelled requests clutter evaluation output, falsely suggest attempted checks, and violate caller expectations that aborting before invocation prevents filesystem mutations.
