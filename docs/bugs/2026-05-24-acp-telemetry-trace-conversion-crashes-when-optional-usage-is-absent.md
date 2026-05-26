# ACP telemetry trace conversion crashes when optional usage is absent

## Summary

`@poe-code/acp-telemetry` exposes `acpToTrace()` for ACP spawn contexts, whose upstream `usage` field is optional. Converting a valid context without usage information throws a `TypeError` instead of producing a trace with no token metrics, because metric collection dereferences `ctx.usage` unconditionally.

## Reproduction

Add the following temporary probe as `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { acpToTrace } from "./trace.js";

describe("ACP trace without usage", () => {
  it("throws while converting an otherwise valid context without usage metrics", () => {
    let message = "";
    try {
      acpToTrace({ agent: "codex", prompt: "hello", events: [] } as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    console.log(JSON.stringify({ message }));
    expect(message).toContain("prompt_tokens");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"message":"Cannot read properties of undefined (reading 'prompt_tokens')"}
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP trace without usage > throws while converting an otherwise valid context without usage metrics
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

`AcpSpawnContext` declares `usage?` as optional in `packages/agent-spawn/src/types.ts`, but `buildMetrics()` in `packages/acp-telemetry/src/trace.ts` casts `ctx.usage` and immediately reads `usage.prompt_tokens`. With no usage object, `acpToTrace()` throws before returning any trace, even though the context has a valid agent, prompt, and event list.

## Expected Behavior

Trace conversion should accept ACP contexts that do not include usage metrics and return an otherwise complete trace with an empty or omitted metrics object. Missing optional accounting data must not prevent telemetry from recording the session output and metadata that are available.

## Impact

ACP runs from adapters, interrupted sessions, or integrations that cannot provide token usage fail telemetry conversion entirely. This can drop traces, obscure agent activity, and turn optional accounting data into a runtime failure in observability pipelines.
