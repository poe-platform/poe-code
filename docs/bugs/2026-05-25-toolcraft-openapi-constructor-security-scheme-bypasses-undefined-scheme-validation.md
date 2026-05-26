# Toolcraft OpenAPI constructor security scheme bypasses undefined scheme validation

## Summary

`toolcraft-openapi` intends to reject an operation or document that references a security scheme absent from `components.securitySchemes`. When the referenced scheme name is `constructor`, generation succeeds against an empty `securitySchemes` object and emits a command with `auth: "required"`, because the validation check accepts the inherited `Object.prototype.constructor` member as though it were a defined scheme.

## Reproduction

From the repository root, run this disposable passing probe:

```sh
cat > packages/toolcraft-openapi/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { generate } from "./generate.js";

describe("OpenAPI inherited security scheme", () => {
  it("accepts constructor as a defined security scheme through Object.prototype", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: { title: "Probe", version: "1.0.0" },
        components: { securitySchemes: {} },
        security: [{ constructor: [] }],
        paths: {
          "/status": {
            get: {
              tags: ["status"],
              operationId: "getStatus",
              responses: { "200": { description: "OK." } }
            }
          }
        }
      },
      { specSha: "probe" }
    );

    const command = files.find((file) => file.path !== "index.ts")?.contents ?? "";
    console.log(JSON.stringify({ emittedRequiredAuth: command.includes('auth: "required"') }));
    expect(command).toContain('auth: "required"');
  });
});
EOF
trap 'rm -f packages/toolcraft-openapi/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"emittedRequiredAuth":true}

✓ packages/toolcraft-openapi/src/__probe__.test.ts > OpenAPI inherited security scheme > accepts constructor as a defined security scheme through Object.prototype
```

## Observed Behavior

The existing tests in `packages/toolcraft-openapi/src/generate.test.ts:469` and `packages/toolcraft-openapi/src/generate.test.ts:502` specify that document-level and operation-level references to undefined security schemes must throw a `UserError`. However, `getOperationAuthMode()` in `packages/toolcraft-openapi/src/generate.ts:1831` through `packages/toolcraft-openapi/src/generate.ts:1853` tests membership with `schemeName in definedSchemes`. For `components.securitySchemes: {}` and a requested scheme named `constructor`, that expression is true through `Object.prototype`, so the invalid specification is accepted and emitted as requiring authentication.

## Expected Behavior

Security requirements should be accepted only when each referenced scheme exists as an own declared member of `components.securitySchemes`. A specification that references `constructor` without declaring it should fail with the same undefined-security-scheme error as any other missing scheme.

## Impact

Generated clients can be produced from invalid OpenAPI security metadata while concealing the specification error that the generator normally surfaces. This can allow malformed or attacker-controlled specifications to pass validation, produce misleading authenticated command definitions, and defer authentication failures or policy confusion until runtime.
