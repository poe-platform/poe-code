# Toolcraft schema number validation accepts positive infinity

## Summary

`toolcraft-schema` emits JSON Schema-compatible number descriptors and its `S.Json()` validator rejects non-finite numeric values, but `validate(S.Number(), Infinity)` reports success. Positive infinity is not a JSON numeric value and cannot be faithfully represented in MCP/JSON payloads, so the primitive number validator permits a value inconsistent with the schema system's serialization domain.

## Reproduction

From the repository root, run a disposable Vitest probe validating positive infinity against a primitive number schema:

```sh
cat > /tmp/toolcraft-schema-positive-infinity-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema non-finite number", () => {
  it("accepts positive infinity for an unconstrained number schema", () => {
    const result = validate(S.Number(), Number.POSITIVE_INFINITY);
    console.log(JSON.stringify({ infinityAccepted: result.ok }));
    expect(result).toMatchObject({ ok: true });
  });
});
EOF
cp /tmp/toolcraft-schema-positive-infinity-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The number validator reports positive infinity as valid:

```text
{"infinityAccepted":true}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema non-finite number > accepts positive infinity for an unconstrained number schema
```

`packages/toolcraft-schema/src/validate.ts:161` through `packages/toolcraft-schema/src/validate.ts:187` reject `NaN` but do not reject either infinity value for ordinary number schemas. By contrast, `packages/toolcraft-schema/src/validate.ts:468` through `packages/toolcraft-schema/src/validate.ts:476` explicitly require `Number.isFinite(value)` for JSON values, demonstrating that non-finite numbers are outside the package's JSON data model.

## Expected Behavior

Primitive number validation should reject positive and negative infinity just as JSON-value validation does, since generated JSON Schema and JSON/MCP transport cannot represent them as valid numbers.

## Impact

An in-process validation pass can accept data that cannot be serialized or transported under the same schema contract. Callers may treat an invalid value as sanitized, then lose it, coerce it to `null`, or fail later when sending the validated payload over JSON-based interfaces.
