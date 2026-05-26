# Toolcraft schema object additional proto property mutates validated output prototype

## Summary

`toolcraft-schema` promises to preserve additional object properties when an `S.Object(..., { additionalProperties: true })` schema accepts them. For an own JSON property named `__proto__`, validation reports success but writes through a normal object assignment, changing the prototype of the returned value instead of preserving an own property.

## Reproduction

From the repository root, run a disposable Vitest probe with an allowed JSON `__proto__` input property:

```sh
cat > /tmp/toolcraft-schema-object-proto-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema object __proto__", () => {
  it("mutates the prototype when preserving an allowed __proto__ object property", () => {
    const schema = S.Object({ name: S.String() }, { additionalProperties: true });
    const input = JSON.parse('{"name":"Ada","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const result = validate(schema, input);
    const value = result.ok ? (result.value as Record<string, unknown>) : {};
    const prototype = Object.getPrototypeOf(value) as { polluted?: boolean } | null;
    console.log(JSON.stringify({ result, ownsProto: Object.hasOwn(value, "__proto__"), prototypePolluted: prototype?.polluted === true }));
    expect(result).toMatchObject({ ok: true });
    expect(Object.hasOwn(value, "__proto__")).toBe(false);
    expect(prototype?.polluted).toBe(true);
  });
});
EOF
cp /tmp/toolcraft-schema-object-proto-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Validation succeeds, but the returned value has no own `__proto__` property and instead inherits the attacker-controlled object as its prototype:

```text
{"result":{"ok":true,"value":{"name":"Ada"}},"ownsProto":false,"prototypePolluted":true}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema object __proto__ > mutates the prototype when preserving an allowed __proto__ object property
```

`packages/toolcraft-schema/src/validate.ts:259` through `packages/toolcraft-schema/src/validate.ts:303` create `nextValue` as a normal `{}` object and copy accepted additional properties using `nextValue[key] = propertyValue`. Assignment to the special `__proto__` key mutates that result object's prototype instead of representing the validated input property as data.

## Expected Behavior

Successful validation with `additionalProperties: true` should preserve each accepted own input property as an own output property, including `__proto__`, without mutating the prototype of the returned object.

## Impact

Validating untrusted JSON through an object schema that permits additional properties can return prototype-mutated data while reporting success. Downstream code that trusts the sanitized output may observe inherited attacker-controlled fields or lose the original property entirely.
