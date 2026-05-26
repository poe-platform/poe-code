# Agent script NaN max steps disables execution ceiling

## Summary

The exported `@poe-code/agent-script` `Budget` API accepts `Number.NaN` as `maxSteps` and silently stops enforcing the configured execution-step ceiling. A caller that passes a malformed computed limit receives a successful sandbox result for work that was intended to be bounded, instead of an argument error or `SandboxError`.

## Reproduction

Create the disposable probe `packages/agent-script/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { Budget, run } from "./index.js";

describe("Budget numeric validation probe", () => {
  it("allows a completed multi-step script when maxSteps is NaN", async () => {
    const result = await run("let count = 0; while (count < 3) { count = count + 1; } return count;", {
      budget: new Budget({
        maxSteps: Number.NaN
      })
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: 3
    });
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-script/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/agent-script/src/__probe__.test.ts > Budget numeric validation probe > allows a completed multi-step script when maxSteps is NaN
```

The script completes successfully with `returnValue: 3` even though the caller supplied a step-budget option. `Budget` stores `options.maxSteps` without validation at `packages/agent-script/src/interp/budget.ts:59` through `packages/agent-script/src/interp/budget.ts:66`, and each node visit enforces the ceiling only through `this.stepsUsed > this.limits.maxSteps` at `packages/agent-script/src/interp/budget.ts:69` through `packages/agent-script/src/interp/budget.ts:83`. Because comparisons against `NaN` are false, that check can never throw for this configured limit.

## Expected Behavior

`Budget` construction should reject non-finite or otherwise invalid execution limits before sandbox execution begins. `maxSteps: Number.NaN` must not behave as an unlimited execution budget.

## Impact

Code-mode tools and direct `agent-script` consumers can unknowingly run scripts outside their intended step ceiling when the configured budget is derived from malformed input or arithmetic. The sandbox still reports a successful completion, so callers may believe a resource constraint was applied while unbounded or substantially excessive interpreter work was permitted.
