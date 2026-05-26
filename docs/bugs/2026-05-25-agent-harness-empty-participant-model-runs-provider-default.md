# Agent harness empty participant model runs provider default

## Summary

The public `@poe-code/agent-harness-tools` participant normalizer accepts `model: ""` as a configured model override, but stage execution silently drops that value. A workflow participant with an explicitly blank model therefore runs without the specified override and falls through to downstream provider/default model selection.

## Reproduction

Create the following disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { normalizeParticipantConfig } from "./participant.js";
import { runWorkflowStage } from "./stage.js";

it("accepts an empty participant model and runs without the configured override", async () => {
  const participant = normalizeParticipantConfig("writer", {
    agent: "codex",
    model: "",
    mode: "edit"
  });
  const runAgent = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));

  await runWorkflowStage(
    { id: "ship", participant: "writer" },
    { cwd: "/repo", participants: { writer: participant }, runAgent, iteration: 0 }
  );

  expect(participant.model).toBe("");
  expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("model");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > accepts an empty participant model and runs without the configured override
```

## Observed Behavior

`packages/agent-harness-tools/src/participant.ts` accepts any string-valued participant `model`, including `""`, and retains it in normalized configuration. `packages/agent-harness-tools/src/stage.ts` forwards the override only through `...(participant.model ? { model: participant.model } : {})`, so the explicitly supplied empty string is dropped because it is falsy. The reproduction observes an agent run with no `model` property even though normalized participant configuration contains one.

## Expected Behavior

An explicitly supplied empty participant model should be rejected as invalid configuration, rather than being accepted and then silently converted into an absent model override during execution.

## Impact

A malformed workflow can invoke an agent using its provider-selected or configured default model instead of the author’s explicit model field semantics. This can alter capability, cost, latency, and behavior while logs and configuration still indicate that a participant model value was supplied.
