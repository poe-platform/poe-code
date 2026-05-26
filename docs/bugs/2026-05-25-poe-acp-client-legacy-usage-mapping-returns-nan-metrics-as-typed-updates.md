# Poe ACP client legacy usage mapping returns NaN metrics as typed updates

## Summary

The exported `@poe-code/poe-acp-client` `mapLegacyEventToSessionUpdates()` helper accepts any JavaScript `number` in a legacy `usage` event, including `NaN` and infinity. It then returns an ACP `usage_update` whose `used`, `size`, or cost fields are non-finite values rather than rejecting malformed protocol data or omitting invalid metrics.

## Reproduction

Add this disposable Vitest probe as `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapLegacyEventToSessionUpdates } from "./stream-helpers.js";

describe("legacy ACP usage numeric validation", () => {
  it("returns non-finite token metrics as typed usage updates", () => {
    const updates = mapLegacyEventToSessionUpdates({
      event: "usage",
      inputTokens: Number.NaN,
      outputTokens: 4,
      cachedTokens: Number.POSITIVE_INFINITY,
      costUsd: Number.NaN
    });

    console.log(JSON.stringify(updates, (_key, value) =>
      Number.isNaN(value) ? "NaN" : value === Number.POSITIVE_INFINITY ? "Infinity" : value
    ));
    expect(updates).toEqual([{ sessionUpdate: "usage_update", used: Number.NaN, size: Number.NaN, cost: { amount: Number.NaN, currency: "USD" } }]);
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and logs a typed ACP usage update whose numeric metrics are non-finite:

```text
[{"sessionUpdate":"usage_update","used":"NaN","size":"NaN","cost":{"amount":"NaN","currency":"USD"}}]
✓ packages/poe-acp-client/src/__probe__.test.ts > legacy ACP usage numeric validation > returns non-finite token metrics as typed usage updates
```

`mapLegacyEventToSessionUpdates()` is publicly exported through `packages/poe-acp-client/src/index.ts` and routes `usage` events into `mapUsage()` in `packages/poe-acp-client/src/stream-helpers.ts`. `mapUsage()` uses `readNumber()` for token and cost fields, while `readNumber()` checks only `typeof value === "number"`; consequently it accepts `NaN` and infinities and uses them in computed ACP usage fields.

## Expected Behavior

Legacy usage conversion should require finite, valid numeric metrics before returning typed ACP usage updates. Non-finite token counts or monetary values should be rejected, ignored, or surfaced as invalid protocol input rather than emitted as apparently valid usage data.

## Impact

Consumers aggregating ACP usage, formatting reports, calculating spend, or emitting telemetry can receive `NaN` totals and costs from malformed legacy events. These values can poison summaries, serialize unexpectedly, invalidate dashboards, or conceal meaningful token accounting errors while passing through a typed public helper result.
