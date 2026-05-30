---
name: "Experiment loop zero metric timeout silently uses default duration"
---

# Experiment loop zero metric timeout silently uses default duration

## Summary

`@poe-code/experiment-loop` declares `metric_timeout` as a non-negative integer and parses `metric_timeout: 0` successfully, but the runtime treats zero as absent. Baseline and post-experiment metric evaluation silently use the built-in 180-second timeout instead of the explicitly configured zero-second timeout.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("zero metric timeout", () => {
  it("passes a configured zero timeout to baseline evaluation", async () => {
    const docPath = "/repo/.poe-code/experiments/timeout.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "metric_timeout: 0",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Measure baseline",
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
    expect(exec).toHaveBeenCalledWith("npm test", { cwd: "/repo", timeout: 0 });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails and prints the timeout actually passed to the metric executor:

```text
[["npm test",{"cwd":"/repo","timeout":180000}]]
AssertionError: expected timeout: 0, received timeout: 180000
```

## Observed Behavior

The frontmatter schema in `packages/experiment-loop/src/frontmatter/frontmatter.ts` permits an integer `metric_timeout` with minimum `0`, and `parseNonNegativeInteger()` retains zero. In `packages/experiment-loop/src/run/loop.ts`, both baseline evaluation and post-agent score evaluation derive milliseconds with `frontmatter.metric_timeout ? frontmatter.metric_timeout * 1000 : undefined`; zero therefore becomes `undefined`. `runMetric()` in `packages/experiment-loop/src/evaluator/evaluator.ts` replaces `undefined` with `DEFAULT_METRIC_TIMEOUT_MS`, resulting in a 180,000 ms execution timeout.

## Expected Behavior

The runtime should honor every configuration value accepted by its public schema. If zero is meaningful, `metric_timeout: 0` should be passed through as `0`; if zero is unsupported, the parser/schema should reject it explicitly rather than silently substituting a much longer default timeout.

## Impact

A plan author can configure a metric to time out immediately and instead wait up to three minutes per metric evaluation. In automated experiment loops this can substantially delay termination, waste runtime, and cause timeout policy to differ silently from the stored plan configuration.
