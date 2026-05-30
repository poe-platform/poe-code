---
name: "Toolcraft OpenAPI constructor schema type crashes command generation"
---

# Toolcraft OpenAPI constructor schema type crashes command generation

## Summary

`toolcraft-openapi` should reject unsupported OpenAPI parameter schema types with its user-facing unsupported-shape error. A query parameter whose schema declares `type: "constructor"` instead passes the scalar-type guard through `Object.prototype`, creates an invalid internal parameter definition, and makes `generate()` throw the internal `TypeError: renderer is not a function`.

## Reproduction

From the repository root, run this disposable passing probe:

```sh
cat > packages/toolcraft-openapi/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { collectGeneratedCommands, generate } from "./generate.js";

describe("OpenAPI inherited scalar schema type", () => {
  it("accepts constructor as a scalar type until rendering crashes internally", () => {
    const document = {
      paths: {
        "/search": {
          get: {
            tags: ["search"],
            operationId: "search",
            parameters: [
              { name: "term", in: "query" as const, schema: { type: "constructor" as never } }
            ],
            responses: { "200": { description: "OK." } }
          }
        }
      }
    };

    const commands = collectGeneratedCommands(document);
    let error: unknown;
    try {
      generate(document, { specSha: "probe" });
    } catch (caught) {
      error = caught;
    }

    console.log(JSON.stringify({ definition: commands[0]?.params[0]?.definition, error: String(error) }));
    expect(commands[0]?.params[0]?.definition).toEqual({ kind: undefined });
    expect(String(error)).toContain("TypeError: renderer is not a function");
  });
});
EOF
trap 'rm -f packages/toolcraft-openapi/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"definition":{},"error":"TypeError: renderer is not a function"}

✓ packages/toolcraft-openapi/src/__probe__.test.ts > OpenAPI inherited scalar schema type > accepts constructor as a scalar type until rendering crashes internally
```

## Observed Behavior

`SCHEMA_TYPE_TO_KIND` in `packages/toolcraft-openapi/src/generate.ts:29` through `packages/toolcraft-openapi/src/generate.ts:37` declares only the supported scalar type names. However, `isOpenApiScalarType()` at `packages/toolcraft-openapi/src/generate.ts:1484` uses `type in SCHEMA_TYPE_TO_KIND`, so the inherited key `constructor` is accepted as if supported. `createParamDefinition()` at `packages/toolcraft-openapi/src/generate.ts:1210` through `packages/toolcraft-openapi/src/generate.ts:1245` subsequently reads the inherited constructor function as `scalarDefinition`, resulting in a generated definition with no valid `kind`. During file generation, `renderDefinition()` at `packages/toolcraft-openapi/src/generate.ts:1910` through `packages/toolcraft-openapi/src/generate.ts:1928` looks up a renderer for that missing kind and throws an implementation-level `TypeError`.

## Expected Behavior

An OpenAPI parameter schema whose `type` is not one of the supported scalar or array shapes should be rejected deterministically with the package's documented `UserError` describing supported shapes. Prototype-inherited names such as `constructor` must not be recognized as supported schema types or cause internal generation exceptions.

## Impact

Malformed or untrusted OpenAPI documents can turn a controlled validation failure into an internal generator crash. This exposes implementation details, produces inconsistent diagnostics for invalid specifications, and can interrupt generation pipelines that expect unsupported API shapes to be rejected cleanly and actionably.
