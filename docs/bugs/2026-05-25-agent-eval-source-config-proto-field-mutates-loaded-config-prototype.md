# Agent Eval source config proto field mutates loaded config prototype

## Summary

The exported `@poe-code/agent-eval` `loadSourceConfig()` API merges arbitrary JSON source-config fields into a normal JavaScript object. A configuration file containing an own `__proto__` field loads successfully but returns a config whose prototype contains the supplied value rather than preserving it as inert source configuration data.

## Reproduction

From the repository root, add a disposable probe at `packages/agent-eval/src/source/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { EvalFs } from "../types.js";
import { loadSourceConfig } from "./config.js";

describe("agent eval source config special fields", () => {
  it("moves an explicit __proto__ setting onto the loaded config prototype", async () => {
    const nodeFs = createFsFromVolume(Volume.fromJSON({
      "/repo/evals/.poe-code-eval.json": '{"__proto__":{"injected":"yes"}}'
    }, "/")).promises;
    const fs = nodeFs as unknown as EvalFs;

    const config = await loadSourceConfig({ rootDir: "/repo/evals" }, fs);

    expect(Object.hasOwn(config as object, "__proto__")).toBe(false);
    expect((config as unknown as { injected?: string }).injected).toBe("yes");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/source/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/source/__probe__.test.ts > agent eval source config special fields > moves an explicit __proto__ setting onto the loaded config prototype
```

Remove the disposable probe after running it.

## Observed Behavior

Loading `.poe-code-eval.json` containing `{"__proto__":{"injected":"yes"}}` returns a source config without an own `__proto__` property, while reading `config.injected` yields `"yes"` through the returned object's prototype. `deepMerge()` in `packages/agent-eval/src/source/config.ts` copies each parsed field into a normal cloned defaults object using `result[key] = value`, so a special JSON key mutates the returned configuration object's prototype.

## Expected Behavior

Source-config loading should preserve accepted own JSON fields as ordinary data or reject unsupported keys before resolving. Parsed input must not control inherited properties of the loaded configuration object.

## Impact

Agent-evaluation source configuration can inject inherited values into downstream consumers while appearing to have loaded successfully. This creates hidden, configuration-controlled state outside normal own-field validation and can distort future option handling or diagnostics as the configuration surface grows.
