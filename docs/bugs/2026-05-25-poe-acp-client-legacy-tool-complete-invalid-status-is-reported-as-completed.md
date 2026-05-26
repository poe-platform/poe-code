# Poe ACP client legacy tool complete invalid status is reported as completed

## Summary

The exported `@poe-code/poe-acp-client` `mapLegacyEventToSessionUpdates()` adapter maps legacy `tool_complete` events into ACP updates. When the legacy event contains an unrecognized completion status such as `"error"`, the adapter silently substitutes `"completed"` instead of rejecting malformed input or preserving an unknown/failure state, causing failure-like completion data to be reported as success.

## Reproduction

Add this disposable Vitest probe as `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapLegacyEventToSessionUpdates } from "./stream-helpers.js";

describe("legacy ACP tool completion status validation", () => {
  it("converts an invalid failure-like status into completed", () => {
    const updates = mapLegacyEventToSessionUpdates({
      event: "tool_complete",
      id: "tool-1",
      status: "error",
      output: "command failed"
    });
    console.log(JSON.stringify(updates));
    expect(updates).toEqual([{ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "command failed" }]);
  });
});
```

Run the focused probe, then remove the disposable test:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and logs an ACP `tool_call_update` marked as completed despite the source event's failure-like status and output:

```text
[{"sessionUpdate":"tool_call_update","toolCallId":"tool-1","status":"completed","rawOutput":"command failed"}]
✓ packages/poe-acp-client/src/__probe__.test.ts > legacy ACP tool completion status validation > converts an invalid failure-like status into completed
```

`mapLegacyEventToSessionUpdates()` is exported through `packages/poe-acp-client/src/index.ts` and dispatches `tool_complete` events to `mapToolComplete()` in `packages/poe-acp-client/src/stream-helpers.ts`. `mapToolComplete()` sets `status: toToolCallStatus(event.status) ?? "completed"`; `toToolCallStatus()` recognizes only ACP status names and returns `undefined` for `"error"`. The fallback therefore changes an invalid failure-like legacy status into an ACP success state while retaining output that says the command failed.

## Expected Behavior

An explicit but unrecognized legacy tool completion status should not be converted to successful completion. The adapter should reject or drop malformed status-bearing events, or map documented failure aliases deliberately, while using an implicit completion default only when a status is genuinely absent and that behavior is part of the compatibility contract.

## Impact

Legacy event producers using a failure status outside the narrow recognized set can have failed tool operations silently represented as completed. Downstream run reports, telemetry, audit trails, and orchestration logic may omit failures, report successful tool execution, or continue workflows using incorrect state even while raw tool output contains an error.
