---
name: "Experiment loop negative metric timeout is ignored and uses default"
---

# Experiment loop negative metric timeout is ignored and uses default

## Summary

`@poe-code/experiment-loop` advertises `metric_timeout` as a non-negative integer, but silently drops a configured negative value during frontmatter normalization. A plan containing `metric_timeout: -1` proceeds to execute its metric command with the built-in 180-second timeout instead of being rejected as invalid configuration.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("invalid metric_timeout frontmatter", () => {
  it("rejects a negative timeout instead of executing with the default timeout", async () => {
    const docPath = "/repo/.poe-code/experiments/negative-timeout.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "metric_timeout: -1",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Do not evaluate",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const exec = vi.fn(async () => ({ stdout: "1\n", stderr: "", exitCode: 0 }));

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    });

    console.log(JSON.stringify(exec.mock.calls));
    expect(exec).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails and prints the substituted default timeout:

```text
[["npm test",{"cwd":"/repo","timeout":180000}]]
AssertionError: expected metric executor not to be called
```

## Observed Behavior

The schema in `packages/experiment-loop/src/frontmatter/frontmatter.ts` defines `metric_timeout` with minimum `0`, but `parseNonNegativeInteger()` returns `undefined` for a negative configured value rather than rejecting the document. `parseExperimentFrontmatterData()` consequently omits the invalid field. During baseline evaluation, `runExperimentLoop()` passes no configured timeout to `evaluateChain()`, and `runMetric()` in `packages/experiment-loop/src/evaluator/evaluator.ts` substitutes `DEFAULT_METRIC_TIMEOUT_MS` of `180_000` milliseconds.

## Expected Behavior

An explicitly supplied negative timeout should be rejected as invalid before any metric script can execute. It should not be silently removed and replaced by a valid default execution duration.

## Impact

A malformed plan that appears to request an invalid or disabled metric timeout can unexpectedly execute metric commands for up to three minutes. This hides configuration errors, wastes runtime, and converts an invalid safety constraint into permissive execution behavior.
