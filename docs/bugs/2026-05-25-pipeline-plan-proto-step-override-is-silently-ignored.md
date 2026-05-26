# Pipeline plan proto step override is silently ignored

## Summary

The exported Pipeline plan parser accepts an inline step override named `__proto__` but does not preserve it as an own override entry. When the parsed overrides are supplied to `loadResolvedSteps()`, the declared step is absent from the resolved executable step configuration without any validation error.

## Reproduction

From the repository root, add a disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadResolvedSteps } from "./config/loader.js";
import { parsePlan } from "./plan/parser.js";

describe("pipeline special step override names", () => {
  it("drops a declared __proto__ override before resolving steps", async () => {
    const plan = parsePlan([
      "steps:",
      "  __proto__:",
      "    prompt: Override prompt",
      "tasks: []",
      ""
    ].join("\n"));
    const fs = createFsFromVolume(Volume.fromJSON({}, "/")).promises;

    const resolved = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs,
      stepOverrides: plan.stepOverrides
    });

    expect(Object.hasOwn(plan.stepOverrides ?? {}, "__proto__")).toBe(false);
    expect(resolved.steps).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline special step override names > drops a declared __proto__ override before resolving steps
```

Remove the disposable probe after running it.

## Observed Behavior

`parsePlan()` successfully accepts an inline `steps.__proto__` override, but `plan.stepOverrides` has no own `__proto__` entry. Passing those parsed overrides to `loadResolvedSteps()` with no base step definitions returns `{ steps: {} }`, so the accepted executable prompt is silently absent. In `packages/pipeline/src/plan/parser.ts`, `stepOverrides` is created as `{}` and populated with `stepOverrides[stepName] = parseStepOverride(...)`, invoking prototype mutation for this dynamic accepted name.

## Expected Behavior

Each accepted inline step override should remain an own entry that `loadResolvedSteps()` can apply, including valid data keys such as `__proto__`, or the parser should reject unsupported names explicitly. A declared execution step must not disappear silently between plan parsing and step resolution.

## Impact

Pipeline documents can declare executable work that is ignored without warning, leading to missing pipeline phases and misleading plan behavior. The parsed override object also receives plan-controlled prototype state rather than inert configuration data.
