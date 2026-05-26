# Pipeline task status constructor step bypasses unknown-step validation

## Summary

The exported `@poe-code/pipeline` `parsePlan()` API accepts a task status entry for a step named `constructor` even when no such pipeline step is defined. The parser is given an empty `availableSteps` map, but it treats the inherited `Object.prototype.constructor` member as a configured step and returns a parsed task that later crashes execution while reading a prompt from that inherited function.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan/parser.js";

describe("pipeline inherited step validation", () => {
  it("accepts a task status for undeclared constructor step", () => {
    const source = [
      "tasks:",
      "  - id: one",
      "    title: One",
      "    prompt: Work",
      "    status:",
      "      constructor: open",
      ""
    ].join("\n");

    expect(() => parsePlan(source, { availableSteps: {} })).not.toThrow();

    const plan = parsePlan(source, { availableSteps: {} });
    expect(plan.tasks[0]?.status).toEqual({ constructor: "open" });
  });
});
```

Run the probe and remove it immediately afterward:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm -f packages/pipeline/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline inherited step validation > accepts a task status for undeclared constructor step
```

To observe the resulting execution failure, extend the probe with:

```ts
import { buildExecutionPrompt, selectNextExecution } from "./run/runner.js";

const selection = selectNextExecution(plan);
expect(selection).toMatchObject({ kind: "run", stepName: "constructor" });
if (selection.kind !== "run") throw new Error("Expected runnable selection");
expect(() => buildExecutionPrompt({ selection, steps: {}, planPath: "/repo/plan.md" }))
  .toThrow(/Cannot read properties of undefined|Cannot read property/);
```

## Observed Behavior

`parsePlan(source, { availableSteps: {} })` returns a task with `status: { constructor: "open" }` instead of throwing `Unknown step "constructor" referenced by task "one".` In `packages/pipeline/src/plan/parser.ts:290` through `packages/pipeline/src/plan/parser.ts:298`, status validation tests each dynamic step name with `stepName in availableSteps`; for the ordinary empty object supplied by callers, `"constructor" in availableSteps` succeeds through inheritance. The resulting status is selected as runnable by `packages/pipeline/src/run/runner.ts:10` through `packages/pipeline/src/run/runner.ts:16`. `buildExecutionPrompt()` then reads `input.steps["constructor"]`, which resolves to the inherited `Object` constructor instead of `undefined`, bypassing its missing-step guard at `packages/pipeline/src/run/runner.ts:79` through `packages/pipeline/src/run/runner.ts:82`; reading `step.prompt` from that function causes a native `Cannot read properties of undefined` error during interpolation.

## Expected Behavior

Task status validation should accept only explicitly defined pipeline steps. With `availableSteps: {}`, a status member named `constructor` is unknown and should be rejected during parsing with the same actionable validation error as any other undeclared step name.

## Impact

A malformed or generated plan can pass initial parsing and validation while carrying a task status that cannot run. The defect changes a clear configuration-time unknown-step error into a later native crash, potentially after planning, selection, locking, progress display, or automation has already treated the plan as valid and runnable.
