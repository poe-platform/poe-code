# Toolcraft schema nonfinite default serializes as null but validation applies infinity

## Summary

`toolcraft-schema` accepts a positive-infinity default for a number schema and applies that value when an optional input is omitted, but `toJsonSchema()` emits the same default into a JSON-based contract where serialization turns it into `null`. The runtime default and the published default therefore disagree.

## Reproduction

From the repository root, run a disposable Vitest probe that applies and serializes an optional number default of positive infinity:

```sh
cat > /tmp/toolcraft-schema-nonfinite-default-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate } from "./index.js";

describe("toolcraft-schema nonfinite default", () => {
  it("serializes an Infinity default as null while validation applies Infinity", () => {
    const schema = S.Optional(S.Number({ default: Number.POSITIVE_INFINITY }));
    const result = validate(schema, undefined);
    const serialized = JSON.stringify(toJsonSchema(schema));
    console.log(JSON.stringify({ resultOk: result.ok, value: result.ok ? String(result.value) : null, serialized }));
    expect(result).toMatchObject({ ok: true, value: Number.POSITIVE_INFINITY });
    expect(serialized).toBe('{"type":"number","default":null}');
  });
});
EOF
cp /tmp/toolcraft-schema-nonfinite-default-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Runtime validation returns positive infinity while the JSON Schema contract publishes `null` as the default:

```text
{"resultOk":true,"value":"Infinity","serialized":"{\"type\":\"number\",\"default\":null}"}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema nonfinite default > serializes an Infinity default as null while validation applies Infinity
```

`packages/toolcraft-schema/src/index.ts:158` through `packages/toolcraft-schema/src/index.ts:174` copy defaults into JSON Schema metadata without checking whether they are JSON-safe. `packages/toolcraft-schema/src/validate.ts:97` through `packages/toolcraft-schema/src/validate.ts:113` and `packages/toolcraft-schema/src/validate.ts:446` through `packages/toolcraft-schema/src/validate.ts:455` independently apply that default as its original JavaScript value.

## Expected Behavior

Defaults accepted by the schema builder must be serializable without changing their meaning, or schema construction should reject non-finite defaults before runtime validation and JSON Schema generation can disagree.

## Impact

Clients consuming generated schema metadata see `null` as the omitted-input default, while server-side validation uses `Infinity`. This produces inconsistent behavior across transport boundaries and can bypass client-side expectation or validation logic.
