# Agent spawn returned config mutation injects arguments into future spawns

## Summary

`@poe-code/agent-spawn` returns live mutable spawn configuration objects through its public `getSpawnConfig()` API. A caller that inspects the Codex spawn config can mutate its `defaultArgs` array and inject arbitrary arguments into later `buildSpawnArgs()` and spawn operations in the same process. Appending `--unexpected-mutated-flag` to the returned Codex config causes an otherwise ordinary future Codex argument build to include that new flag.

## Reproduction

Create a disposable Vitest probe at `packages/agent-spawn/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSpawnArgs, getSpawnConfig } from "./index.js";

describe("agent-spawn returned config mutation", () => {
  it("does not let callers inject arguments into later Codex spawns", () => {
    const exposed = getSpawnConfig("codex");
    if (!exposed || exposed.kind !== "cli") {
      throw new Error("Expected Codex CLI config");
    }

    const original = [...exposed.defaultArgs];
    try {
      exposed.defaultArgs.push("--unexpected-mutated-flag");
      const result = buildSpawnArgs("codex", { prompt: "hello" });

      expect(result.args).not.toContain("--unexpected-mutated-flag");
    } finally {
      exposed.defaultArgs.splice(0, exposed.defaultArgs.length, ...original);
    }
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/agent-spawn/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-spawn/src/__probe__.test.ts
```

## Observed Behavior

The probe fails because the argument injected through the supposedly observational config value appears in the later spawn argument list:

```text
FAIL  packages/agent-spawn/src/__probe__.test.ts > agent-spawn returned config mutation > does not let callers inject arguments into later Codex spawns
AssertionError: expected [ 'exec', 'hello', …(5) ] to not include '--unexpected-mutated-flag'
 ❯ packages/agent-spawn/src/__probe__.test.ts:16:31
```

`codexSpawnConfig` contains the mutable `defaultArgs` array at `packages/agent-spawn/src/configs/codex.ts:4` through `:32`. `allSpawnConfigs` and the internal lookup store that same object, and `getSpawnConfig()` returns it directly at `packages/agent-spawn/src/configs/index.ts:12` through `:38`. Later, `buildCliArgs()` spreads `config.defaultArgs` into actual command arguments at `packages/agent-spawn/src/spawn.ts:88` through `:155`.

## Expected Behavior

Public spawn configuration inspection must not expose mutable process-global configuration used by later execution. `getSpawnConfig()` and exported registry data should be immutable or defensively copied so caller mutations cannot inject, remove, or rewrite arguments for future agent commands.

## Impact

A package consumer, extension, or test that reads spawn configuration can accidentally or intentionally alter every later Codex invocation in that runtime. Injected flags can modify sandboxing, output mode, model behavior, or other CLI semantics, producing unexpected execution and undermining trust in arguments supplied by the actual spawn caller.
