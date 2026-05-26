# Agent Maestro exported attempt transition mutation reopens terminal phase

## Summary

The public `@poe-code/agent-maestro` API exports `ATTEMPT_TRANSITIONS` as a read-only record, but its nested transition arrays remain mutable at runtime. A caller that reads the public attempt-phase metadata can append a new edge to `ATTEMPT_TRANSITIONS.succeeded`, after which the exported `transitionPhase()` function accepts a transition from terminal `succeeded` back to `running-step`.

## Reproduction

Create a disposable probe at `packages/agent-maestro/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ATTEMPT_TRANSITIONS, transitionPhase } from "./index.js";

describe("agent-maestro exported attempt transition mutation", () => {
  it("lets public transition metadata reopen a terminal succeeded attempt", () => {
    const terminalTargets = ATTEMPT_TRANSITIONS.succeeded as string[];
    terminalTargets.push("running-step");

    try {
      expect(transitionPhase({ phase: "succeeded" }, "running-step", { step: "unexpected" })).toEqual({
        phase: "running-step",
        step: "unexpected"
      });
    } finally {
      terminalTargets.pop();
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-maestro/src/__probe__.test.ts
```

The probe passes, showing that a terminal attempt can be reopened after public metadata mutation:

```text
✓ packages/agent-maestro/src/__probe__.test.ts > agent-maestro exported attempt transition mutation > lets public transition metadata reopen a terminal succeeded attempt
```

## Observed Behavior

`ATTEMPT_TRANSITIONS` is declared with empty terminal transition arrays in `packages/agent-maestro/src/runtime/phases.ts:25` through `packages/agent-maestro/src/runtime/phases.ts:31` and re-exported publicly at `packages/agent-maestro/src/index.ts:438` through `packages/agent-maestro/src/index.ts:444`. The read-only TypeScript annotation does not freeze the nested arrays. `transitionPhase()` validates transitions directly against the live array through `ATTEMPT_TRANSITIONS[current.phase].includes(next)` at `packages/agent-maestro/src/runtime/phases.ts:35` through `packages/agent-maestro/src/runtime/phases.ts:60`. After appending `"running-step"` to `ATTEMPT_TRANSITIONS.succeeded`, it returns a new running state for an attempt that was previously terminal.

## Expected Behavior

Public inspection of Maestro transition metadata must not modify the transition rules used by future operations. Exported phase-transition definitions should be deeply immutable or defensively copied, and terminal attempt states must remain terminal regardless of prior metadata readers.

## Impact

Same-process consumers can accidentally or deliberately corrupt Maestro attempt lifecycle validation. A completed task attempt can be made active again through the supported API, enabling contradictory progress events, duplicate work, or retry/cleanup behavior for an operation already recorded as successfully finished.
