# Toolcraft schema builders emit invalid JSON Schema constraints

## Summary

`toolcraft-schema` builders accept invalid constraint metadata without validation and serialize it directly into JSON Schema. Negative string or array size bounds, malformed regular-expression patterns, and non-finite number bounds can all be constructed and published, yielding invalid or unrepresentable schema contracts while runtime validation behaves unpredictably or rejects every ordinary value.

## Reproduction

From the repository root, run a disposable Vitest probe that builds schemas with invalid constraint metadata and inspects their serialized and runtime behavior:

```sh
cat > /tmp/toolcraft-schema-invalid-metadata-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S, toJsonSchema, validate } from "./index.js";

describe("toolcraft-schema invalid metadata", () => {
  it("creates impossible or malformed constraints without rejecting schema construction", () => {
    const stringSchema = S.String({ minLength: -1, maxLength: -2, pattern: "[" });
    const arraySchema = S.Array(S.String(), { minItems: -1, maxItems: -2 });
    const numberSchema = S.Number({ minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY });
    const outputs = {
      stringJson: toJsonSchema(stringSchema),
      stringValidation: validate(stringSchema, ""),
      arrayJson: toJsonSchema(arraySchema),
      arrayValidation: validate(arraySchema, []),
      numberJson: JSON.stringify(toJsonSchema(numberSchema)),
      numberValidation: validate(numberSchema, 0)
    };
    console.log(JSON.stringify(outputs));
    expect(outputs.stringJson).toMatchObject({ minLength: -1, maxLength: -2, pattern: "[" });
    expect(outputs.arrayJson).toMatchObject({ minItems: -1, maxItems: -2 });
    expect(outputs.numberJson).toContain('"minimum":null');
  });
});
EOF
cp /tmp/toolcraft-schema-invalid-metadata-probe.test.ts packages/toolcraft-schema/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-schema/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

All invalid schemas are constructed and converted without rejection. The output includes negative size constraints, an invalid regex pattern, and non-finite numeric bounds that JSON serialization changes to `null`:

```text
{"stringJson":{"type":"string","minLength":-1,"maxLength":-2,"pattern":"["},"stringValidation":{"ok":false,"issues":[{"path":[],"expected":"string with length at most -2","received":"string with length 0","message":"Expected string with length at most -2 at value, got string with length 0"},{"path":[],"expected":"string matching pattern [","received":"","message":"Expected string matching pattern [ at value, got "}]},"arrayJson":{"type":"array","items":{"type":"string"},"minItems":-1,"maxItems":-2},"arrayValidation":{"ok":false,"issues":[{"path":[],"expected":"array with at most -2 items","received":"array with 0 items","message":"Expected array with at most -2 items at value, got array with 0 items"}]},"numberJson":"{\"type\":\"number\",\"minimum\":null,\"maximum\":null}","numberValidation":{"ok":false,"issues":[{"path":[],"expected":"number greater than or equal to Infinity","received":"0","message":"Expected number greater than or equal to Infinity at value, got 0"},{"path":[],"expected":"number less than or equal to -Infinity","received":"0","message":"Expected number less than or equal to -Infinity at value, got 0"}]}}
✓ packages/toolcraft-schema/src/__probe__.test.ts > toolcraft-schema invalid metadata > creates impossible or malformed constraints without rejecting schema construction
```

`packages/toolcraft-schema/src/index.ts:177` through `packages/toolcraft-schema/src/index.ts:226` copy metadata directly into JSON Schema, and the builders at `packages/toolcraft-schema/src/index.ts:297` through `packages/toolcraft-schema/src/index.ts:359` perform no constraint validation. During runtime validation, `packages/toolcraft-schema/src/validate.ts:127` through `packages/toolcraft-schema/src/validate.ts:155` compile malformed patterns only when checking a value and treat compilation failure as a mismatch, while numeric and array bounds are applied exactly as declared.

## Expected Behavior

Schema construction should reject invalid metadata before a schema can be used or serialized: size bounds must be non-negative valid integers, numeric bounds must be finite and coherent, and patterns must compile as valid regular expressions.

## Impact

Tool authors can accidentally publish malformed JSON Schema definitions to MCP clients and simultaneously create runtime validators that reject ordinary valid-looking inputs. For non-finite bounds, the serialized client-facing contract is also changed to `null`, diverging from the runtime validation behavior.
