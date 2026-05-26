# Model Strategy Config Failed Save Corrupts Prior Selection State

## Summary

`StrategyConfigManager.saveConfig()` writes directly over the live persisted strategy JSON file. If an update partially overwrites that file before throwing, the failed save destroys the previous valid model-selection configuration and subsequent loads fall back to `null` after logging a parse error.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("strategy config interrupted overwrite", () => {
  it("leaves prior valid strategy json unreadable when save fails mid-write", async () => {
    let stored = JSON.stringify({ type: "fixed", fixedModel: "gpt-5.4" });
    vi.resetModules();
    vi.doMock("fs", () => ({
      existsSync: () => true,
      mkdirSync: vi.fn(),
      readFileSync: () => stored,
      writeFileSync: () => {
        stored = "{";
        throw new Error("strategy disk full");
      },
    }));
    const { StrategyConfigManager } = await import("./model-strategy.js");

    expect(() => StrategyConfigManager.saveConfig({ type: "fixed", fixedModel: "gpt-5.5" })).toThrow("strategy disk full");
    const loaded = StrategyConfigManager.loadConfig();
    console.log(JSON.stringify({ stored, loaded }));
    expect(stored).toBe("{");
    expect(loaded).toBeNull();
    vi.doUnmock("fs");
    vi.resetModules();
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints the corrupted persisted content and absent reloaded configuration:

```text
{"stored":"{","loaded":null}
✓ src/services/__probe__.test.ts > strategy config interrupted overwrite > leaves prior valid strategy json unreadable when save fails mid-write
```

The run also logs the `SyntaxError` from attempting to parse the partially written configuration. Remove the disposable probe after validation.

## Observed Behavior

`StrategyConfigManager.saveConfig()` writes the replacement configuration directly to `strategy-config.json` through `fs.writeFileSync()` at `src/services/model-strategy.ts:239`. `loadConfig()` subsequently catches parse errors and returns `null` at `src/services/model-strategy.ts:242`. In the probe, a failed save changes the stored valid fixed-model selection into `"{"`; loading afterward logs a parse failure and returns no usable previous configuration.

## Expected Behavior

Strategy configuration updates should be committed atomically, preserving the last valid selection state if a replacement write cannot complete. A rejected save should not cause later loads to lose the previously configured strategy.

## Impact

A transient disk-full or interrupted write during strategy changes can silently remove the user's durable model-selection preference after the save already reported failure. Later execution may fall back to unrelated defaults or prompt behavior while the only persisted prior selection has been made unreadable.
