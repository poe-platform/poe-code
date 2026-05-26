# Toolcraft schema declared proto property is lost from successful validation result

## Summary

`toolcraft-schema` allows an object schema to explicitly declare an own field named `__proto__`, but `validate()` cannot preserve that valid field in its successful output. Validation reports `{ ok: true }` for an input containing the required string value, while the returned object silently omits the declared property.

## Reproduction

From the repository root, run this disposable passing probe:

```sh
cat > packages/toolcraft-schema/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema declared __proto__ field", () => {
  it("reports success while dropping a validated declared proto value", () => {
    const shape = Object.create(null) as Record<string, ReturnType<typeof S.String>>;
    shape.__proto__ = S.String();
    const schema = S.Object(shape);
    const input = JSON.parse('{"__proto__":"owned"}') as Record<string, unknown>;

    const result = validate(schema, input);

    console.log(JSON.stringify({
      result,
      inputOwnsProto: Object.hasOwn(input, "__proto__"),
      outputOwnsProto: result.ok && Object.hasOwn(result.value, "__proto__")
    }));
    expect(result.ok).toBe(true);
    expect(Object.hasOwn(input, "__proto__")).toBe(true);
    expect(result.ok && Object.hasOwn(result.value, "__proto__")).toBe(false);
  });
});
EOF
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"result":{"ok":true,"value":{}},"inputOwnsProto":true,"outputOwnsProto":false}

✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema declared __proto__ field > reports success while dropping a validated declared proto value
```

## Observed Behavior

`packages/toolcraft-schema/src/validate.ts:271` constructs validated object output as a normal `{}` record. For every declared schema property, `packages/toolcraft-schema/src/validate.ts:274` through `packages/toolcraft-schema/src/validate.ts:280` assigns the successfully validated value with `nextValue[key] = result.value`. When the declared key is `__proto__` and the accepted value is a primitive string, the special assignment does not create an own data property; the returned value remains `{}` even though validation succeeds.

This is a separate runtime validation path from the existing JSON Schema serialization report and from validation of allowed *additional* or record keys: here the field is explicitly declared by the object schema and required by successful validation.

## Expected Behavior

When a schema explicitly declares an accepted property, a successful `validate()` result should retain the validated own property and value, including keys such as `__proto__`, or reject such schema keys up front. It must not report successful validation while silently discarding required input data.

## Impact

Consumers using `toolcraft-schema` for validated command, SDK, or API objects can lose a field that the schema explicitly accepts and requires. Data loss is silent because the result is marked valid, and downstream code receives an object that no longer matches the declared schema or original validated payload.
