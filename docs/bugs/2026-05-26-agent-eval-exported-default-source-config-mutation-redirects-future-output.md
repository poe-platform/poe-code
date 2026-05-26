# Agent eval exported default source config mutation redirects future output

## Summary

The exported `@poe-code/agent-eval` `defaultSourceConfig` object is mutable and is read again whenever a source has no `.poe-code-eval.json` file. Mutating its public `out` field changes the output-directory default returned for later evaluation sources, allowing one consumer to redirect subsequent run, report, or check paths in the same process.

## Reproduction

Create a disposable probe at `packages/agent-eval/src/source/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultSourceConfig, loadSourceConfig } from "./config.js";

describe("agent-eval exported default source config mutation", () => {
  it("redirects later missing-config output defaults", async () => {
    const originalOut = defaultSourceConfig.out;
    defaultSourceConfig.out = "redirected-runs";

    try {
      const fs = {
        async readFile(): Promise<string> {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
      };

      await expect(
        loadSourceConfig({ rootDir: "/repo/evals" } as never, fs as never)
      ).resolves.toMatchObject({ out: "redirected-runs" });
    } finally {
      defaultSourceConfig.out = originalOut;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-eval/src/source/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/source/__probe__.test.ts
```

The probe passes, confirming that mutation of the exported default changes a later source load with no config file:

```text
✓ packages/agent-eval/src/source/__probe__.test.ts > agent-eval exported default source config mutation > redirects later missing-config output defaults
```

## Observed Behavior

`defaultSourceConfig` is declared as an ordinary nested object at `packages/agent-eval/src/source/config.ts:6` through `packages/agent-eval/src/source/config.ts:17` and publicly re-exported at `packages/agent-eval/src/index.ts:7`. When a source does not contain `.poe-code-eval.json`, `loadSourceConfig()` calls `cloneDefaultConfig()` at `packages/agent-eval/src/source/config.ts:27` through `packages/agent-eval/src/source/config.ts:35`. That cloning function reads current values directly from the exported object at `packages/agent-eval/src/source/config.ts:54` through `packages/agent-eval/src/source/config.ts:60`. After setting `defaultSourceConfig.out = "redirected-runs"`, a subsequent missing-config source loads with that mutated `out` value. The run/report CLI paths and `evalCheck()` consume `config.out` when resolving output directories at `packages/agent-eval/src/cli/commands.ts:129` through `packages/agent-eval/src/cli/commands.ts:172` and `packages/agent-eval/src/check/check.ts:27` through `packages/agent-eval/src/check/check.ts:28`.

## Expected Behavior

Public access to documented default configuration values should not mutate the defaults used for later evaluation sources. The exported default object should be deeply immutable or consumers should receive defensive copies while internal source loading uses an immutable canonical default, so absence of source configuration consistently selects `runs` unless the source or invocation explicitly overrides it.

## Impact

Any same-process plugin, command extension, or SDK consumer can unintentionally alter output selection for later evaluations that rely on defaults. Results may be written to or read from an unexpected subdirectory, reports and checks may target different run data than requested, and execution behavior becomes dependent on unrelated code that previously inspected or modified public default configuration metadata.
