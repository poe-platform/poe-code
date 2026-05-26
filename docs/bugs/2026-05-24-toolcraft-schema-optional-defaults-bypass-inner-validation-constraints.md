# Toolcraft schema optional defaults bypass inner validation constraints

## Summary

`toolcraft-schema` applies defaults for missing optional values without validating those defaults against the wrapped schema. Invalid defaults can violate minimum lengths, numeric bounds, or enum membership while `validate()` still reports a successful sanitized value.

## Reproduction

From the repository root, run a disposable Vitest probe with three optional defaults that violate their declared inner schemas:

```sh
cat > /tmp/toolcraft-schema-default-validation-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema defaults", () => {
  it("returns optional defaults that violate their inner schemas", () => {
    const schema = S.Object({
      count: S.Optional(S.Number({ minimum: 1, default: 0 })),
      mode: S.Optional(S.Enum(["safe", "fast"] as const, { default: "invalid" as "safe" })),
      code: S.Optional(S.String({ minLength: 3, default: "x" }))
    });
    const result = validate(schema, {});
    console.log(JSON.stringify({ result }));
    expect(result).toEqual({ ok: true, value: { count: 0, mode: "invalid", code: "x" } });
  });
});
EOF
cp /tmp/toolcraft-schema-default-validation-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Validation succeeds and returns values that each contradict the schema constraints which would be applied if supplied as ordinary input:

```text
{"result":{"ok":true,"value":{"count":0,"mode":"invalid","code":"x"}}}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema defaults > returns optional defaults that violate their inner schemas
```

`packages/toolcraft-schema/src/validate.ts:97` through `packages/toolcraft-schema/src/validate.ts:113` resolve a missing optional value by returning `getDefault(schema.inner)` directly. The default does not pass back through `walkSchema()` and therefore bypasses the string, number, and enum checks implemented for ordinary values.

## Expected Behavior

Defaults returned by validation should satisfy the same schema rules as user-supplied values. Invalid declared defaults should either be rejected when schemas are built or reported as validation errors when applied.

## Impact

Callers use validation output as trusted normalized data, but an invalid package-authored default can silently inject values that violate its own published schema. This can bypass downstream assumptions and create discrepancies between omitted inputs and equivalent explicit inputs.
