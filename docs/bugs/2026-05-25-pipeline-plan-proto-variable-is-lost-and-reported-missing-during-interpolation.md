# Pipeline plan proto variable is lost and reported missing during interpolation

## Summary

`@poe-code/pipeline` accepts a plan variable named `__proto__` in YAML but drops it while constructing the parsed variable map. The exported `interpolatePipelineVars()` API then reports that explicitly declared variable as missing when a task or prompt references `{{ __proto__ }}`.

## Reproduction

From the repository root, add a disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePlan } from "./plan/parser.js";
import { interpolatePipelineVars } from "./vars/interpolate.js";

describe("pipeline special variable names", () => {
  it("loses a declared __proto__ variable and later reports it missing", () => {
    const plan = parsePlan([
      "vars:",
      "  __proto__: declared-value",
      "tasks: []",
      ""
    ].join("\n"));

    expect(Object.hasOwn(plan.vars ?? {}, "__proto__")).toBe(false);
    expect(() => interpolatePipelineVars("{{ __proto__ }}", plan.vars ?? {})).toThrow(
      'Missing pipeline variable "__proto__"'
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline special variable names > loses a declared __proto__ variable and later reports it missing
```

Remove the disposable probe after running it.

## Observed Behavior

`parsePlan()` accepts the YAML `vars.__proto__` declaration but returns `plan.vars` without an own `__proto__` key. Passing that parsed map to `interpolatePipelineVars("{{ __proto__ }}", ...)` throws `Missing pipeline variable "__proto__"`. In `packages/pipeline/src/plan/parser.ts`, the variable-copy loop initializes `vars` as `{}` and executes `vars[key] = val`, which mutates the object's prototype for the accepted special key instead of retaining the declared string value.

## Expected Behavior

Every accepted plan variable should survive parsing as an own key and remain available to placeholder interpolation, including legal data keys such as `__proto__`, or the parser should explicitly reject those names. A declared variable must not subsequently be reported as absent.

## Impact

Pipeline plans can fail at prompt construction despite containing the required variable declaration. This prevents tasks from running, makes configuration errors appear misleading, and permits plan-controlled prototype mutation in the intermediate variable map.
