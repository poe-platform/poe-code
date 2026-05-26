# Model strategy exported available models mutation redirects future round-robin selection

## Summary

The exported model-strategy `AVAILABLE_MODELS` tuple is a mutable runtime array, and the default `RoundRobinStrategy` copies its values when a new strategy is constructed. A caller that mutates this advertised supported-model list can inject an arbitrary model identifier into later automatic round-robin selections.

## Reproduction

Create a disposable probe at `src/services/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { AVAILABLE_MODELS, RoundRobinStrategy } from "./model-strategy.js";

const originalFirstModel = AVAILABLE_MODELS[0];

afterEach(() => {
  (AVAILABLE_MODELS as unknown as string[])[0] = originalFirstModel;
});

describe("model-strategy exported model-list mutation", () => {
  it("redirects future default round-robin selections", () => {
    (AVAILABLE_MODELS as unknown as string[])[0] = "untrusted-model";

    const strategy = new RoundRobinStrategy();

    expect(strategy.getNextModel()).toBe("untrusted-model");
    expect(strategy.getDescription()).toContain("untrusted-model");
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
rm -f src/services/__probe__.test.ts
```

The probe passes:

```text
✓ src/services/__probe__.test.ts > model-strategy exported model-list mutation > redirects future default round-robin selections
```

## Observed Behavior

`AVAILABLE_MODELS` is exported as an `as const` array at `src/services/model-strategy.ts:14` through `src/services/model-strategy.ts:25`. Although that assertion makes the tuple read-only to ordinary TypeScript callers, the runtime array remains writable. `RoundRobinStrategy` creates its default model sequence by spreading the current contents of that same exported array at `src/services/model-strategy.ts:163` through `src/services/model-strategy.ts:183`, and `ModelStrategyFactory` exposes construction of a round-robin strategy at `src/services/model-strategy.ts:193` through `src/services/model-strategy.ts:207`. After mutating `AVAILABLE_MODELS[0]` to `"untrusted-model"`, a newly constructed default round-robin strategy returns that unadvertised replacement as its first selected model.

## Expected Behavior

Public supported-model metadata should not be able to alter the model routing performed by subsequently constructed strategies. The exported list should be immutable at runtime, or the strategy should read from protected canonical model definitions so metadata inspection cannot redirect future selection.

## Impact

Any same-process extension or consumer importing the model-strategy metadata can silently cause later automatic routing to choose an arbitrary unsupported or unintended model. This can alter provider behavior, availability, costs, credentials, or failure modes without the persisted strategy configuration requesting that model.
