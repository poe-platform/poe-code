# Poe ACP format session update infinite cost produces unparsable notification

## Summary

The exported `@poe-code/poe-acp-client` `formatSessionUpdate()` function accepts a typed `usage_update` carrying `cost.amount: Infinity` and serializes it through JSON as `null`. The package's corresponding `parseSessionUpdate()` function rejects that emitted notification, so its public formatter can produce an update that its own public parser cannot read back.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatSessionUpdate, parseSessionUpdate, type SessionUpdate } from "./index.js";

describe("formatSessionUpdate non-finite cost", () => {
  it("serializes an accepted typed cost into a notification the parser rejects", () => {
    const update: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 1,
      size: 2,
      cost: { amount: Number.POSITIVE_INFINITY, currency: "USD" }
    };

    const encoded = formatSessionUpdate("session-1", update);

    expect(encoded).toContain('"amount":null');
    expect(parseSessionUpdate(encoded)).toBeNull();
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > formatSessionUpdate non-finite cost > serializes an accepted typed cost into a notification the parser rejects
```

## Observed Behavior

Calling `formatSessionUpdate("session-1", update)` with an otherwise valid typed usage update whose cost amount is `Infinity` returns JSON containing `"cost":{"amount":null,"currency":"USD"}`. Passing that exact string into `parseSessionUpdate()` returns `null` rather than the original update or a validated equivalent.

`packages/poe-acp-client/src/index.ts:21` exports both public round-trip functions. `formatSessionUpdate()` constructs a typed notification and directly applies `JSON.stringify()` at `packages/poe-acp-client/src/jsonrpc.ts:681` through `packages/poe-acp-client/src/jsonrpc.ts:702`, so JavaScript converts the non-finite numeric amount to `null`. Parsing subsequently validates usage cost with `typeof value.cost.amount !== "number"` at `packages/poe-acp-client/src/jsonrpc.ts:595` through `packages/poe-acp-client/src/jsonrpc.ts:628`, rejecting the serialized result because `null` is not a numeric amount.

This is distinct from legacy-event mapping accepting non-finite usage values: this defect occurs when a caller supplies the package's typed `SessionUpdate` input directly to its public notification formatter, which emits incompatible wire data.

## Expected Behavior

The public formatter should reject non-finite usage amounts before serialization, or otherwise encode only values that satisfy the package's parser and ACP wire contract. A successful formatting operation should produce a notification accepted by `parseSessionUpdate()` when given the same package-defined typed value.

## Impact

SDK callers constructing typed ACP usage notifications can emit silently corrupted JSON that downstream consumers, including the package itself, discard as invalid. Non-finite accounting values can therefore break telemetry/session update streams while the serialization operation reports success, obscuring the original invalid metric source.
