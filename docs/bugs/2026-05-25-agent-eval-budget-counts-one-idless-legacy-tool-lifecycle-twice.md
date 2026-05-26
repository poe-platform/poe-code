# Agent eval budget counts one idless legacy tool lifecycle twice

## Summary

The exported `@poe-code/agent-eval` trace and budget APIs can represent a single legacy tool call as an ID-less `tool_start` event followed by an ID-less `tool_complete` event, but `BudgetEnforcer` increments its iteration counter for both events. One completed tool lifecycle therefore consumes two iterations and can abort an evaluation that is still within its configured tool-call budget.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BudgetEnforcer } from "./run/budget.js";
import { normalizeTrace } from "./run/trace/normalize.js";
import type { SpawnEvent } from "./types.js";

describe("agent-eval id-less legacy tool lifecycle budget", () => {
  it("counts one tool lifecycle as one iteration", () => {
    const trace = normalizeTrace([
      { event: "tool_start", title: "Read", kind: "read", path: "src/file.ts" } as SpawnEvent,
      { event: "tool_complete", title: "Read", kind: "read", path: "src/file.ts" } as SpawnEvent
    ]);
    const controller = new AbortController();
    const enforcer = new BudgetEnforcer(
      { maxIterations: 2, maxTokens: 100, wallClockMs: 60_000 },
      controller
    );

    for (const event of trace.events) {
      enforcer.onEvent(event);
    }

    console.log(JSON.stringify({ events: trace.events, snapshot: enforcer.snapshot() }));
    expect(enforcer.snapshot().iterations).toBe(1);
    expect(controller.signal.aborted).toBe(false);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe logs a two-iteration snapshot for one lifecycle and fails:

```text
{"events":[{"type":"tool","sequence":0,"phase":"start","name":"Read","operation":"read","paths":["src/file.ts"]},{"type":"tool","sequence":1,"phase":"complete","name":"Read","operation":"read","paths":[],"inspection":{"status":"uninspectable","reason":"missing-path"},"outcome":"completed"}],"snapshot":{"iterations":2,"usage":{"inputTokens":0,"outputTokens":0},"elapsedMs":0,"tripped":"maxIterations"}}
AssertionError: expected 2 to be 1 // Object.is equality
```

## Observed Behavior

`packages/agent-eval/src/index.ts` publicly exports `BudgetEnforcer` and `normalizeTrace()`. `normalizeTrace()` accepts legacy `event: "tool_start"` without an id and separately emits a terminal `event: "tool_complete"` without an id. In `packages/agent-eval/src/run/budget.ts`, `countToolIteration()` increments every tool event that has no `id`, because it cannot deduplicate the lifecycle through `countedToolIds`. With `maxIterations: 2`, one started-and-completed legacy tool call produces `iterations: 2` and trips `maxIterations`.

## Expected Behavior

A single logical tool invocation should consume one iteration regardless of whether the source event protocol includes a lifecycle id. The evaluator should correlate legacy start/completion events when possible, or count only one phase when correlation is unavailable, rather than aborting on duplicated accounting.

## Impact

Agents emitting legacy ID-less tool lifecycle events can have their evaluations terminated earlier than their configured iteration budget allows. This causes false `budget_exceeded` outcomes, penalizes otherwise valid runs, and makes equivalent tool activity consume different budgets depending only on the event transport shape.
