# Agent harness model-only participant runs without agent id

## Summary

The public `@poe-code/agent-harness-tools` participant normalizer rejects blank agent strings, but accepts a model-only inline specifier such as `:openai/gpt-5.4`. The malformed participant then proceeds into stage execution and invokes the configured runner with no agent identifier before the colon.

## Reproduction

Create the following disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { normalizeParticipantConfig } from "./participant.js";
import { runWorkflowStage } from "./stage.js";

it("accepts a model-only participant specifier and runs it as an agent", async () => {
  const participant = normalizeParticipantConfig("writer", ":openai/gpt-5.4");
  const runAgent = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));

  await runWorkflowStage(
    { id: "ship", participant: "writer", mode: "edit" },
    {
      cwd: "/repo",
      participants: { writer: participant },
      runAgent,
      iteration: 0
    }
  );

  expect(participant.agent).toBe(":openai/gpt-5.4");
  expect(runAgent.mock.calls[0]?.[0].agent).toBe(":openai/gpt-5.4");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > accepts a model-only participant specifier and runs it as an agent
```

## Observed Behavior

`packages/agent-defs/src/specifier.ts` parses `:openai/gpt-5.4` as an empty agent and a non-empty model, then `normalizeAgentId()` formats it back into the non-empty string `:openai/gpt-5.4`. `packages/agent-harness-tools/src/participant.ts` validates only that this normalized string has non-zero length, so it treats the malformed specifier as a valid participant agent. `packages/agent-harness-tools/src/stage.ts` subsequently forwards that exact value to `runAgent()`.

## Expected Behavior

Participant normalization should reject inline agent specifiers whose agent portion is empty, just as it rejects blank agent strings, before any workflow stage can execute.

## Impact

Malformed workflow participant configuration can reach autonomous execution with a model but no provider identifier. This can produce late provider-resolution failures, unintended fallback handling, or misleading workflow logs for a stage that should have failed configuration validation before running.
