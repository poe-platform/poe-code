# Toolcraft schema integer enum accepts fractional declared member

## Summary

`toolcraft-schema` allows callers to construct an enum with fractional numeric members while explicitly declaring `jsonType: "integer"`. The emitted JSON Schema claims the enum accepts only integers, yet runtime validation successfully accepts the fractional member exactly as declared. The package therefore exposes contradictory client-facing and server-side validation contracts for one schema object.

## Reproduction

From the repository root, run a disposable Vitest probe that constructs an integer-flavored enum containing `1.5`, serializes it, and validates that fractional member:

```sh
cat > packages/toolcraft-schema/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate } from "./index.js";

describe("integer enum schema mismatch repro", () => {
  it("publishes integer type while accepting a fractional enum member", () => {
    const schema = S.Enum([1.5, 2] as const, { jsonType: "integer" });
    const jsonSchema = toJsonSchema(schema);
    const validation = validate(schema, 1.5);

    console.log(JSON.stringify({ jsonSchema, validation }));

    expect(jsonSchema).toEqual({ type: "integer", enum: [1.5, 2] });
    expect(validation).toEqual({ ok: true, value: 1.5 });
  });
});
EOF
npm exec -- vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-schema/src/__probe__.test.ts
nl -ba packages/toolcraft-schema/src/index.ts | sed -n '89,109p;229,267p;320,337p;389,410p'
nl -ba packages/toolcraft-schema/src/validate.ts | sed -n '199,221p'
```

## Observed Behavior

The serialized schema advertises an integer type with a fractional enum literal, while the validator accepts that fractional literal successfully:

```text
{"jsonSchema":{"enum":[1.5,2],"type":"integer"},"validation":{"ok":true,"value":1.5}}
✓ packages/toolcraft-schema/src/__probe__.test.ts > integer enum schema mismatch repro > publishes integer type while accepting a fractional enum member
```

The enum type permits number members and an optional `jsonType: "integer"` marker in `packages/toolcraft-schema/src/index.ts:89` through `packages/toolcraft-schema/src/index.ts:109`. The builder validates only non-emptiness and uniqueness in `packages/toolcraft-schema/src/index.ts:254` through `packages/toolcraft-schema/src/index.ts:267` and `packages/toolcraft-schema/src/index.ts:320` through `packages/toolcraft-schema/src/index.ts:337`; it never checks that members are integers when that marker is set. Serialization uses the supplied integer type in `packages/toolcraft-schema/src/index.ts:389` through `packages/toolcraft-schema/src/index.ts:410`, while runtime enum validation only checks membership in `packages/toolcraft-schema/src/validate.ts:199` through `packages/toolcraft-schema/src/validate.ts:221`.

## Expected Behavior

An enum declared with `jsonType: "integer"` should reject non-integer numeric members during schema construction, or runtime and serialized behavior should consistently treat the enum as a general numeric enum rather than publishing an integer-only contract.

## Impact

MCP or SDK clients consuming the generated JSON Schema can correctly reject `1.5` as incompatible with an integer schema even though the server-side validator accepts it. This causes generated forms, client validation, and server execution to disagree about valid enum inputs, producing avoidable request rejection or interoperability failures.
