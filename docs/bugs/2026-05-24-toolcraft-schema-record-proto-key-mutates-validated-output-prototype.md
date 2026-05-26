# Toolcraft schema record proto key mutates validated output prototype

## Summary

`toolcraft-schema` record validation copies arbitrary accepted record keys into a normal output object. When a valid JSON record contains an own `__proto__` key with an object value, `validate(S.Record(...), input)` reports success but changes the returned record's prototype instead of retaining the validated entry as record data.

## Reproduction

From the repository root, run a disposable Vitest probe validating a JSON record with a `__proto__` entry:

```sh
cat > /tmp/toolcraft-schema-record-proto-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema record __proto__", () => {
  it("mutates the prototype when preserving a __proto__ record key", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const result = validate(S.Record(S.Json()), input);
    const value = result.ok ? (result.value as Record<string, unknown>) : {};
    const prototype = Object.getPrototypeOf(value) as { polluted?: boolean } | null;
    console.log(JSON.stringify({ result, ownsProto: Object.hasOwn(value, "__proto__"), prototypePolluted: prototype?.polluted === true }));
    expect(result).toMatchObject({ ok: true });
    expect(Object.hasOwn(value, "__proto__")).toBe(false);
    expect(prototype?.polluted).toBe(true);
  });
});
EOF
cp /tmp/toolcraft-schema-record-proto-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The record validation succeeds while replacing the returned object's prototype with the supplied `__proto__` value:

```text
{"result":{"ok":true,"value":{}},"ownsProto":false,"prototypePolluted":true}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema record __proto__ > mutates the prototype when preserving a __proto__ record key
```

`packages/toolcraft-schema/src/validate.ts:413` through `packages/toolcraft-schema/src/validate.ts:435` build every validated record into a plain `{}` and assign each validated entry through `nextValue[key] = result.value`. A validated `__proto__` key consequently changes the result object's prototype rather than becoming an own record field.

## Expected Behavior

Record validation should return an object containing all successfully validated own record keys, including `__proto__`, without prototype mutation.

## Impact

Any consumer using `S.Record(...)` to validate arbitrary JSON maps can receive prototype-mutated output from accepted data. This loses a validated key and can introduce inherited attacker-controlled values into subsequent record processing.
