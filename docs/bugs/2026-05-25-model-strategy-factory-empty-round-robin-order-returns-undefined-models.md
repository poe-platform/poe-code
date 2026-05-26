# Model strategy factory accepts empty round-robin order and returns undefined models

## Summary

The exported `ModelStrategyFactory.createStrategy()` API accepts a `round-robin` configuration with `customOrder: []`, then creates a `RoundRobinStrategy` whose `getNextModel()` returns `undefined` on every call instead of selecting a model or rejecting the unusable configuration.

## Reproduction

From the repository root, add this disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ModelStrategyFactory } from "./model-strategy.js";

describe("empty round-robin strategy configuration", () => {
  it("creates a strategy whose next model is undefined", () => {
    const strategy = ModelStrategyFactory.createStrategy({
      type: "round-robin",
      customOrder: [],
    });

    const firstModel = strategy.getNextModel();
    const secondModel = strategy.getNextModel();
    console.log(JSON.stringify({
      name: strategy.getName(),
      description: strategy.getDescription(),
      firstType: typeof firstModel,
      secondType: typeof secondModel,
    }));

    expect(firstModel).toBeUndefined();
    expect(secondModel).toBeUndefined();
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"name":"round-robin","description":"Cycles through: ","firstType":"undefined","secondType":"undefined"}
✓ src/services/__probe__.test.ts > empty round-robin strategy configuration > creates a strategy whose next model is undefined
```

## Observed Behavior

`StrategyConfig.customOrder` exposes an arbitrary `ModelIdentifier[]` at `src/services/model-strategy.ts:35`, and `ModelStrategyFactory.createStrategy()` forwards an empty array directly to `new RoundRobinStrategy(config.customOrder)` at `src/services/model-strategy.ts:193`. Since an empty array is truthy, the constructor retains it at `src/services/model-strategy.ts:167`. `getNextModel()` then reads `this.models[0]` as `undefined` and updates its index using modulo zero at `src/services/model-strategy.ts:171`, so subsequent selections remain unusable as well.

## Expected Behavior

A configured round-robin strategy should always produce a valid configured model. An empty custom order should either be rejected as invalid configuration or treated as an omitted order that falls back to `AVAILABLE_MODELS`.

## Impact

Consumers can persist or supply a syntactically accepted strategy configuration that resolves to no model at runtime. Any code relying on the exported strategy API to choose the next model may pass `undefined` downstream, fail later with an unrelated model-selection error, or silently bypass the user's intended routing policy.
