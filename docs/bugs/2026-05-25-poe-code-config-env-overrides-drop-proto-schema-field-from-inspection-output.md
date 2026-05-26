# Poe Code Config Environment Overrides Drop a `__proto__` Schema Field From Inspection Output

## Summary

The public `@poe-code/config` `collectEnvOverrides()` API silently omits an environment override when a caller-defined scope schema declares a field named `__proto__`. Even though the environment supplies the declared variable, both returned inspection views report no override.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { collectEnvOverrides, defineScope } from "./index.js";

describe("config env override prototype-key field repro", () => {
  it("drops an environment override for a schema field named __proto__", () => {
    const schema = Object.fromEntries([
      ["__proto__", { type: "string", default: "", env: "PROTO_VALUE", doc: "Proto field" }]
    ]);
    const scope = defineScope("custom", schema as never);

    const result = collectEnvOverrides([scope], { PROTO_VALUE: "visible" });

    expect(result.entries).toEqual([]);
    expect(result.document).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the environment override is not exposed by either returned inspection representation. Remove the disposable probe after validation.

## Observed Behavior

For a public scope built by `defineScope("custom", schema)` where `schema` owns a `__proto__` string field with `env: "PROTO_VALUE"`, calling `collectEnvOverrides([scope], { PROTO_VALUE: "visible" })` returns `{ entries: [], document: {} }`. In `packages/poe-code-config/src/inspect.ts`, `collectScopeEnvOverrides()` copies each coerced environment value into `values = {}` via `values[key] = value`; assigning the key `__proto__` changes the ordinary object's prototype instead of creating an own data field. `collectEnvOverrides()` then sees no own keys and discards the scope and its entries entirely.

## Expected Behavior

Environment override inspection should preserve and display every declared scope field supplied by the environment, including `__proto__`, or explicitly reject unsupported field names when defining a scope instead of silently reporting that no override exists.

## Impact

Callers inspecting configuration can be told that no environment override applies even though an explicitly declared and populated variable was provided. This hides effective configuration input during diagnostics and makes caller-defined schemas unreliable for prototype-sensitive field names.
