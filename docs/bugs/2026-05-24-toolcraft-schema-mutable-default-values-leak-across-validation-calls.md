# Toolcraft schema mutable default values leak across validation calls

## Summary

`toolcraft-schema` returns optional array and object defaults by reference rather than producing fresh validated output values. If one consumer mutates a defaulted validation result, subsequent independent validation calls receive the mutated state and the identical object reference.

## Reproduction

From the repository root, run a disposable Vitest probe that mutates defaulted array and object outputs before validating missing input again:

```sh
cat > /tmp/toolcraft-schema-shared-default-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, validate } from "./index.js";

describe("toolcraft-schema mutable defaults", () => {
  it("returns the same mutable array default across validation calls", () => {
    const defaultTags: string[] = [];
    const schema = S.Optional(S.Array(S.String(), { default: defaultTags }));
    const first = validate(schema, undefined);
    if (!first.ok) throw new Error("expected first validation success");
    first.value.push("mutated");
    const second = validate(schema, undefined);
    console.log(JSON.stringify({ first: first.value, second: second.ok ? second.value : null, sameReference: second.ok && first.value === second.value }));
    expect(second).toEqual({ ok: true, value: ["mutated"] });
    expect(second.ok && first.value === second.value).toBe(true);
  });

  it("returns the same mutable object default across validation calls", () => {
    const defaultConfig = { mode: "safe" };
    const schema = S.Optional(S.Object({ mode: S.String() }, { default: defaultConfig }));
    const first = validate(schema, undefined);
    if (!first.ok) throw new Error("expected first validation success");
    first.value.mode = "changed";
    const second = validate(schema, undefined);
    console.log(JSON.stringify({ objectSecond: second.ok ? second.value : null, sameReference: second.ok && first.value === second.value }));
    expect(second).toEqual({ ok: true, value: { mode: "changed" } });
    expect(second.ok && first.value === second.value).toBe(true);
  });
});
EOF
cp /tmp/toolcraft-schema-shared-default-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both mutable defaults retain the mutation in a later validation and are returned by identical reference:

```text
{"first":["mutated"],"second":["mutated"],"sameReference":true}
{"objectSecond":{"mode":"changed"},"sameReference":true}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema mutable defaults > returns the same mutable array default across validation calls
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema mutable defaults > returns the same mutable object default across validation calls
```

`packages/toolcraft-schema/src/validate.ts:97` through `packages/toolcraft-schema/src/validate.ts:113` return a resolved default immediately for missing optional input, and `packages/toolcraft-schema/src/validate.ts:446` through `packages/toolcraft-schema/src/validate.ts:455` return `schema.default` directly without cloning or walking its contents.

## Expected Behavior

Each validation should produce independent normalized data. Mutable default arrays and objects should not be shared across callers or calls, and mutations of one validation result should not change later defaulted results.

## Impact

State leaks between otherwise independent command invocations or requests that rely on schema defaults. A caller mutating its own validated configuration can silently change the defaults observed by future callers, leading to cross-request contamination and nondeterministic behavior.
