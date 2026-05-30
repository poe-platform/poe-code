---
name: "Experiment metric stderr-only failure is misreported as timeout"
---

# Experiment metric stderr-only failure is misreported as timeout

## Summary

`@poe-code/experiment-loop` appends a timeout remediation message to every failed metric command that emits no stdout and no numeric score, even when the command immediately fails with a clear stderr diagnostic. Missing scripts, syntax errors, and other ordinary command failures are therefore falsely presented as metric timeouts.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/experiment-loop/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator/evaluator.js";

describe("metric failure timeout diagnostics", () => {
  it("labels an immediate stderr-only command failure as a timeout", async () => {
    const result = await evaluate("node missing-script.mjs", "/repo", async () => ({
      stdout: "",
      stderr: "Error: Cannot find module 'missing-script.mjs'\n",
      exitCode: 1
    }), 5000);

    console.log(JSON.stringify(result));
    expect(result.passed).toBe(false);
    expect(result.output).toContain("Cannot find module");
    expect(result.output).toContain("Metric timed out after 5s");
  });
});
PROBE
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

Output:

```text
{"score":null,"passed":false,"output":"Error: Cannot find module 'missing-script.mjs'\n\nMetric timed out after 5s. Increase timeout via metric_timeout in experiment frontmatter."}
✓ packages/experiment-loop/src/__probe__.test.ts > metric failure timeout diagnostics > labels an immediate stderr-only command failure as a timeout
```

## Observed Behavior

`runMetric()` in `packages/experiment-loop/src/evaluator/evaluator.ts:26` through `packages/experiment-loop/src/evaluator/evaluator.ts:50` sets `timedOut` solely when `exitCode !== 0`, parsing produced no score, and `stdout.length === 0`. It does not examine whether execution actually timed out or whether stderr already explains an immediate ordinary failure. The reproduction supplies a direct module-not-found error on stderr with a nonzero exit code and no stdout; `evaluate()` still appends `Metric timed out after 5s` and advises increasing `metric_timeout`.

## Expected Behavior

Timeout guidance should be emitted only when the execution layer reports an actual activity or duration timeout. A metric command that exits immediately with a stderr error should return that failure without an unrelated timeout diagnosis or misleading configuration recommendation.

## Impact

Users debugging broken metric scripts receive incorrect remediation instructions, may repeatedly increase timeouts instead of fixing command errors, and can waste experiment runs while genuine failures remain obscured. Automated agents consuming the output can likewise make incorrect repairs based on a false timeout signal.
