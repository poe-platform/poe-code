# Toolcraft schema JSON validation crashes on cyclic runtime values

## Summary

`validate(S.Json(), value)` is documented and typed as validating arbitrary candidate input into JSON-compatible values, but its recursive `isJsonValue()` traversal has no cycle detection. Supplying a cyclic plain object or array throws `Maximum call stack size exceeded` instead of returning the normal `{ ok: false, issues }` validation result for a non-JSON value.

## Reproduction

From the repository root, run a disposable Vitest probe with a self-referential object passed to `S.Json()` validation:

```sh
cat > packages/toolcraft-schema/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S } from "./index.js";
import { validate } from "./validate.js";
describe("toolcraft JSON schema cyclic runtime value", () => {
  it("throws a stack overflow instead of returning a validation issue", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let outcome: unknown;
    try {
      outcome = validate(S.Json(), cyclic);
    } catch (error) {
      outcome = { thrown: error instanceof Error ? error.message : String(error) };
    }
    console.log(JSON.stringify(outcome));
    expect(outcome).toMatchObject({ thrown: expect.stringMatching(/call stack|recursion/i) });
  });
});
EOF
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
nl -ba packages/toolcraft-schema/src/validate.ts | sed -n '25,37p'
nl -ba packages/toolcraft-schema/src/validate.ts | sed -n '437,487p'
```

## Observed Behavior

Instead of reporting the cyclic object as invalid JSON input, validation recurses until the JavaScript stack is exhausted:

```text
{"thrown":"Maximum call stack size exceeded"}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft JSON schema cyclic runtime value > throws a stack overflow instead of returning a validation issue
```

The public validator returns structured success or issue results in `packages/toolcraft-schema/src/validate.ts:25` through `packages/toolcraft-schema/src/validate.ts:37`. For `S.Json()`, `walkJson()` delegates to `isJsonValue()` in `packages/toolcraft-schema/src/validate.ts:437` through `packages/toolcraft-schema/src/validate.ts:443`, while the recursive object and array traversal in `packages/toolcraft-schema/src/validate.ts:468` through `packages/toolcraft-schema/src/validate.ts:487` does not track already-visited references.

## Expected Behavior

Runtime values that contain reference cycles are not JSON values and should be rejected through the validator's structured issue result without throwing. Validation should remain bounded for arbitrary JavaScript input.

## Impact

Commands, MCP handlers, or SDK consumers using `S.Json()` for untrusted or programmatically assembled input can crash validation with a cyclic payload rather than receiving a recoverable input error. This can turn ordinary argument validation into process-level denial of service or unexpected command failure.
