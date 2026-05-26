# Pipeline named step config proto step is silently dropped

## Summary

The exported `@poe-code/pipeline` `loadResolvedSteps()` API silently drops an executable named step called `__proto__` when reading YAML step configuration. The YAML is accepted and loaded, but the returned `config.steps` map does not contain the declared step as an own entry.

## Reproduction

From the repository root, add a disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadResolvedSteps } from "./config/loader.js";

describe("pipeline named step config special names", () => {
  it("drops an executable __proto__ step loaded from YAML config", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/repo/.poe-code/pipeline/steps/default.yaml": [
        "steps:",
        "  __proto__:",
        "    prompt: Execute custom step",
        ""
      ].join("\n")
    }, "/")).promises;

    const config = await loadResolvedSteps({ cwd: "/repo", homeDir: "/home/test", fs });

    expect(Object.hasOwn(config.steps, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(config.steps)).toEqual({ mode: "yolo", prompt: "Execute custom step" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline named step config special names > drops an executable __proto__ step loaded from YAML config
```

Remove the disposable probe after running it.

## Observed Behavior

Loading a named steps YAML file that declares `steps.__proto__.prompt` returns `config.steps` with no own `__proto__` step, while its prototype equals the parsed step definition `{ mode: "yolo", prompt: "Execute custom step" }`. `parseStepConfigData()` in `packages/pipeline/src/config/loader.ts` constructs `steps` as `{}` and writes each parsed dynamic step name with `steps[stepName] = parseDef(...)`, so the valid special name mutates the intermediate step map instead of representing an executable step.

## Expected Behavior

Named step configuration should preserve every accepted step definition as an own executable entry, including a data key such as `__proto__`, or reject unsupported names explicitly. Loading a valid YAML steps file must not silently omit declared work.

## Impact

Configured pipeline steps can disappear before plan execution, causing workflows to run without named phases or to fail to find expected work. The failure affects reusable step configuration independently of inline plan overrides and stores YAML-controlled prototype state in the returned configuration map.
