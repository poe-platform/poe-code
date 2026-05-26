# Poe code config numeric env Infinity bypasses finite value filter

## Summary

`@poe-code/poe-code-config` accepts the environment string `"Infinity"` for a schema field declared as `type: "number"`, returning and displaying `Infinity` as a resolved numeric configuration value. The same resolver rejects a direct numeric `Infinity` value from stored configuration, so an environment override can bypass its finite-number validation boundary.

## Reproduction

Create the following disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineScope } from "./schema.js";
import { collectEnvOverrides } from "./inspect.js";
import { resolveScope } from "./resolve.js";

describe("non-finite numeric env override probe", () => {
  it("accepts Infinity from numeric environment values", () => {
    const definition = defineScope("timeouts", {
      timeout: {
        type: "number",
        default: 30,
        env: "POE_TIMEOUT",
        doc: "Timeout"
      }
    });

    const inspection = collectEnvOverrides([definition], { POE_TIMEOUT: "Infinity" });
    const resolved = resolveScope(definition.schema, undefined, { POE_TIMEOUT: "Infinity" });

    console.log(JSON.stringify({
      inspectionValue: String(inspection.document.timeouts?.timeout),
      inspectionEntry: inspection.entries[0],
      resolvedValue: String(resolved.timeout),
      finite: Number.isFinite(resolved.timeout)
    }));

    expect(inspection.document.timeouts?.timeout).toBe(Infinity);
    expect(resolved.timeout).toBe(Infinity);
    expect(Number.isFinite(resolved.timeout)).toBe(false);
  });
});
```

Run it and remove the probe afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm packages/poe-code-config/src/__probe__.test.ts
```

Output:

```text
stdout | packages/poe-code-config/src/__probe__.test.ts > non-finite numeric env override probe > accepts Infinity from numeric environment values
{"inspectionValue":"Infinity","inspectionEntry":"  POE_TIMEOUT = Infinity","resolvedValue":"Infinity","finite":false}

 ✓ packages/poe-code-config/src/__probe__.test.ts > non-finite numeric env override probe > accepts Infinity from numeric environment values 1ms
```

## Observed Behavior

Numeric configuration values supplied as actual JavaScript numbers are accepted only when finite in `packages/poe-code-config/src/resolve.ts:68`, but numeric strings are converted with `Number()` and rejected only when `Number.isNaN()` is true in `packages/poe-code-config/src/resolve.ts:73`. Because `Number("Infinity")` is `Infinity` rather than `NaN`, `resolveScope()` returns the non-finite value. The inspection path repeats the same behavior for environment output in `packages/poe-code-config/src/inspect.ts:99`, causing `collectEnvOverrides()` to publish `POE_TIMEOUT = Infinity` as a valid active override.

## Expected Behavior

Numeric environment values should be subject to the same finite-number rule as numeric stored values. `"Infinity"`, `"-Infinity"`, and other inputs that produce non-finite numbers should be ignored or rejected instead of resolving as typed numeric configuration.

## Impact

Any consumer defining an environment-backed numeric scope through this exported configuration API can receive a non-finite value despite the resolver's apparent finite-value guard. Timeout, concurrency, retry, polling, budget, or size settings driven through such a scope can therefore become unbounded or behave incorrectly solely because of an environment override, while configuration inspection misleadingly reports that override as accepted.
