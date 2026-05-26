# Model Strategy Config Load Accepts Unsupported Fixed Model

## Summary

`StrategyConfigManager.loadConfig()` accepts persisted JSON through an unchecked type assertion, and `ModelStrategyFactory` forwards an arbitrary stored `fixedModel` string into `FixedStrategy`. A malformed or externally modified strategy config can therefore select a model identifier that is not present in `AVAILABLE_MODELS`.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("stored model strategy config validation", () => {
  it("loads and selects an unsupported fixed model from persisted json", async () => {
    vi.resetModules();
    vi.doMock("fs", () => ({
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ type: "fixed", fixedModel: "attacker-model" }),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    }));
    const { ModelStrategyFactory, StrategyConfigManager } = await import("./model-strategy.js");

    const config = StrategyConfigManager.loadConfig();
    if (!config) throw new Error("missing strategy config");
    const selected = ModelStrategyFactory.createStrategy(config).getNextModel();
    console.log(JSON.stringify({ config, selected }));
    expect(selected).toBe("attacker-model");
    vi.doUnmock("fs");
    vi.resetModules();
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"config":{"type":"fixed","fixedModel":"attacker-model"},"selected":"attacker-model"}
✓ src/services/__probe__.test.ts > stored model strategy config validation > loads and selects an unsupported fixed model from persisted json
```

Remove the disposable probe after validation.

## Observed Behavior

`StrategyConfigManager.loadConfig()` parses stored JSON and immediately casts it to `StrategyConfig` at `src/services/model-strategy.ts:246`, without validating `type`, `fixedModel`, or `customOrder`. For a fixed strategy, `ModelStrategyFactory.createStrategy()` passes the stored value into `FixedStrategy` at `src/services/model-strategy.ts:201`, and `FixedStrategy.getNextModel()` returns it unchanged at `src/services/model-strategy.ts:139`. The probe therefore selects `"attacker-model"`, although it is absent from the enumerated supported model list.

## Expected Behavior

Persisted strategy configuration should be validated before use. `fixedModel` and every `customOrder` item should be accepted only when they are supported `AVAILABLE_MODELS` values, with invalid stored configuration rejected or safely replaced by a documented default.

## Impact

Corrupted, stale, or externally edited strategy configuration can make model selection return an unsupported identifier while appearing to load successfully. Downstream spawning or routing may fail later with misleading provider/model errors, and callers cannot trust the typed strategy configuration contract after reading persisted state.
