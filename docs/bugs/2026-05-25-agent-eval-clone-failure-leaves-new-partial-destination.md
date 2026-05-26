# Agent Eval clone failure leaves a newly created partial destination behind

## Summary

`cloneTarget()` records whether `dest` exists before cloning, but it removes a newly created destination only when the supplied abort signal has been aborted. If an ordinary `git clone` failure occurs after creating files in a previously absent destination, the function rejects while leaving the partial clone directory on disk.

## Reproduction

1. Add this disposable probe as `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  destinationExists: false,
  access: vi.fn(async () => {
    if (state.destinationExists) return;
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }),
  rm: vi.fn(async () => {
    state.destinationExists = false;
  }),
  clone: vi.fn(async () => {
    state.destinationExists = true;
    throw new Error("git clone failed after creating destination");
  })
}));

vi.mock("node:fs/promises", () => ({
  access: state.access,
  mkdir: vi.fn(),
  rm: state.rm
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({ clone: state.clone }))
}));

import { cloneTarget } from "./clone.js";

describe("cloneTarget failed clone destination cleanup probe", () => {
  afterEach(() => {
    state.destinationExists = false;
    vi.clearAllMocks();
  });

  it("leaves a newly created partial destination after a non-abort clone failure", async () => {
    await expect(
      cloneTarget({ repo: "fixture", ref: "main", dest: "/runs/new-clone" })
    ).rejects.toThrow("git clone failed after creating destination");

    expect(state.destinationExists).toBe(true);
    expect(state.rm).not.toHaveBeenCalled();
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after confirming the result.

The probe passes on the current implementation:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > cloneTarget failed clone destination cleanup probe > leaves a newly created partial destination after a non-abort clone failure
```

## Observed Behavior

The failed `clone()` invocation simulates a Git operation that has already created the destination before rejecting. `cloneTarget()` propagates the clone error, but it never invokes `rm()` because the failure was not caused by an aborted `AbortSignal`, leaving the newly created partial destination present.

## Expected Behavior

When `cloneTarget()` starts with an absent destination and the clone cannot complete, it should remove the newly created incomplete destination before propagating the failure, regardless of whether the failure resulted from cancellation or an ordinary Git error. A destination that existed before invocation should remain untouched.

## Impact

Failed evaluation setup can leave incomplete clone directories in run output locations. Those artifacts consume disk space, misrepresent failed runs as having materialized repositories, and can interfere with retries or external tooling that assumes an existing clone destination is complete and usable.
