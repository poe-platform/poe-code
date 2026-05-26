# Plan browser editFile swallows editor launch failure

## Summary

The exported `@poe-code/plan-browser` `editFile()` helper launches the configured editor with `spawnSync()` but ignores the returned error and exit status. If the editor executable cannot be started, `editFile()` returns successfully instead of reporting that no editing session occurred, allowing higher-level UI actions to announce a successful edit after launch failure.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { editFile } from "./actions.js";

describe("failed editor launch", () => {
  it("surfaces a configured editor that cannot be launched", () => {
    const spawnSync = vi.fn(() => ({
      error: Object.assign(new Error("spawn missing-editor ENOENT"), { code: "ENOENT" }),
      status: null,
      signal: null,
      pid: 0,
      output: [],
      stdout: null,
      stderr: null
    })) as unknown as typeof import("node:child_process").spawnSync;

    expect(() => editFile("/repo/docs/plans/plan.md", {
      env: { EDITOR: "missing-editor" },
      spawnSync
    })).toThrow("ENOENT");
    console.log(JSON.stringify({ calls: vi.mocked(spawnSync).mock.calls.length }));
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

The configured editor fails to launch, but `editFile()` does not throw:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > failed editor launch > surfaces a configured editor that cannot be launched
AssertionError: expected [Function] to throw an error
- Expected: null
+ Received: undefined
```

## Observed Behavior

`editFile()` in `packages/plan-browser/src/actions.ts` resolves the configured editor and calls `spawnSync(editor, [absolutePath], { stdio: "inherit" })`, but it does not inspect the returned `error`, `status`, or `signal` fields. In the reproduction, the injected child-process result contains an `ENOENT` launch error and no editor process exists, yet the exported helper completes normally. The plan browser and Maestro TUI actions that call this helper subsequently refresh and display an `Edited ...` toast when no edit was possible.

## Expected Behavior

If the configured editor cannot be spawned or exits unsuccessfully before performing the requested editing operation, the helper should surface that failure so callers do not report a successful edit. At minimum, `spawnSync().error` must cause rejection or an exception.

## Impact

Missing editor binaries, permissions failures, invalid editor configuration, or other launch errors are silently reported as successful interactions. Users can believe they changed a plan or task source file when no editor appeared, while surrounding workflows refresh state and proceed without any actionable failure diagnostic.
