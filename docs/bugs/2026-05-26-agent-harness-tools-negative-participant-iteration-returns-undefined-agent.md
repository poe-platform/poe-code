# Agent Harness Tools negative participant iteration returns undefined agent

## Summary

The exported `@poe-code/agent-harness-tools` `selectParticipantAgent()` function declares that it returns a `string`, but accepts an arbitrary numeric `iteration` without validation. For a participant configured with rotating agents, a negative iteration indexes the array with a negative property name and returns `undefined` instead of selecting an agent or rejecting the invalid iteration.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { selectParticipantAgent, type WorkflowParticipant } from "./participant.js";

describe("participant rotation iteration validation", () => {
  it("returns undefined for a negative iteration despite declaring a string result", () => {
    const participant: WorkflowParticipant = {
      id: "ensemble",
      agent: ["claude-code", "codex"]
    };

    const selected = selectParticipantAgent(participant, -1);
    console.log(JSON.stringify({ selected, type: typeof selected }));
    expect(selected).toBeUndefined();
  });
});
EOF
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"type":"undefined"}
```

## Observed Behavior

For `agent: ["claude-code", "codex"]`, `selectParticipantAgent(participant, -1)` resolves successfully with the runtime value `undefined`, contradicting its public `string` return type. Consumers that forward this result as an agent identifier do not receive a controlled invalid-iteration diagnostic at the selection boundary.

`selectParticipantAgent()` is publicly exported at `packages/agent-harness-tools/src/index.ts:9` through `packages/agent-harness-tools/src/index.ts:13`. Its rotating-agent branch calculates `iteration % participant.agent.length` and reads the array at that index at `packages/agent-harness-tools/src/participant.ts:102` through `packages/agent-harness-tools/src/participant.ts:111`. JavaScript evaluates `-1 % 2` as `-1`, so the array lookup retrieves no selected agent and returns `undefined` despite the declared return type.

## Expected Behavior

The selector should require a finite non-negative integer iteration before rotating through configured agents, or define a safe wraparound behavior for negative values. It must not return `undefined` from a public API typed as returning a valid agent identifier string.

## Impact

SDK callers, workflow adapters, or tests that calculate an invalid negative iteration can silently lose the configured agent identity before launching work. Downstream code may report unknown-agent errors, apply defaults unexpectedly, construct malformed spawn requests, or fail later in less actionable code instead of receiving an immediate validation error from the rotation API.
