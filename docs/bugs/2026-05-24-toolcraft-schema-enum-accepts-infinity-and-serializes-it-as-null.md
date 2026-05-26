# Toolcraft schema enum accepts infinity and serializes it as null

## Summary

`toolcraft-schema` accepts positive infinity as a member of `S.Enum(...)`, validates that member successfully, and then emits a JSON Schema enum whose value becomes `null` when serialized. The resulting published schema describes a different accepted value from the runtime validator.

## Reproduction

From the repository root, run a disposable Vitest probe creating and validating an enum containing positive infinity:

```sh
cat > /tmp/toolcraft-schema-enum-infinity-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate } from "./index.js";

describe("toolcraft-schema enum infinity", () => {
  it("accepts a non-finite enum value that JSON serializes as null", () => {
    const schema = S.Enum([Number.POSITIVE_INFINITY] as const);
    const json = toJsonSchema(schema);
    const result = validate(schema, Number.POSITIVE_INFINITY);
    const serialized = JSON.stringify(json);
    console.log(JSON.stringify({ resultOk: result.ok, value: result.ok ? String(result.value) : null, json: serialized }));
    expect(result).toMatchObject({ ok: true, value: Number.POSITIVE_INFINITY });
    expect(serialized).toBe('{"enum":[null],"type":"number"}');
  });
});
EOF
cp /tmp/toolcraft-schema-enum-infinity-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The runtime validator accepts `Infinity`, while JSON serialization changes the same allowed enum value to `null`:

```text
{"resultOk":true,"value":"Infinity","json":"{\"enum\":[null],\"type\":\"number\"}"}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema enum infinity > accepts a non-finite enum value that JSON serializes as null
```

`packages/toolcraft-schema/src/index.ts:251` through `packages/toolcraft-schema/src/index.ts:263` only reject duplicate enum values, not non-finite numbers. `packages/toolcraft-schema/src/index.ts:321` through `packages/toolcraft-schema/src/index.ts:337` therefore accept the member, and `packages/toolcraft-schema/src/index.ts:391` through `packages/toolcraft-schema/src/index.ts:404` copy it into the JSON Schema `enum` array, where ordinary JSON serialization turns infinity into `null`.

## Expected Behavior

Enum values must be valid JSON enum members. `S.Enum(...)` should reject non-finite numbers or otherwise guarantee that `toJsonSchema()` preserves exactly the values accepted by runtime validation.

## Impact

A Toolcraft command can publish a schema that tells MCP/JSON clients to send `null` while the runtime implementation accepts `Infinity` instead. Clients cannot reliably produce an input satisfying the runtime validator from the serialized contract.
