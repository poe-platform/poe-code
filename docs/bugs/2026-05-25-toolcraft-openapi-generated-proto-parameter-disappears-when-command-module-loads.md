# Toolcraft OpenAPI generated proto parameter disappears when command module loads

## Summary

`toolcraft-openapi` accepts an OpenAPI operation with a query parameter named `__proto__` and emits TypeScript command source that appears to declare that parameter. When the generated module is evaluated, JavaScript object-literal `__proto__` semantics prevent it from becoming an own schema field, so the command silently loses a valid API parameter before it can be exposed through CLI, MCP, or SDK surfaces.

## Reproduction

From the repository root, run this disposable passing probe:

```sh
cat > packages/toolcraft-openapi/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { S } from "toolcraft";
import { defineApiCommand } from "./api-command.js";
import { generate } from "./generate.js";
import { requestJson } from "./http.js";

describe("OpenAPI generated __proto__ parameter", () => {
  it("drops a valid parameter while evaluating generated command source", () => {
    const files = generate({
      paths: {
        "/search": {
          get: {
            tags: ["search"],
            operationId: "search",
            parameters: [{ name: "__proto__", in: "query", schema: { type: "string" } }],
            responses: { "200": { description: "OK." } }
          }
        }
      }
    }, { specSha: "probe" });
    const contents = files.find((file) => file.path === "search/list.ts")?.contents ?? "";
    const transformed = contents
      .replace(/^import .*$/gmu, "")
      .replaceAll(" as const", "")
      .replaceAll(": unknown;", ";")
      .replace("export const searchListCommand = defineApiCommand(", "exports.command = defineApiCommand(");
    const execute = new Function("S", "defineApiCommand", "requestJson", "exports", `${transformed}\nreturn exports.command;`) as (
      schema: typeof S,
      define: typeof defineApiCommand,
      request: typeof requestJson,
      exports: Record<string, unknown>
    ) => { params: { shape: Record<string, unknown> } };
    const command = execute(S, defineApiCommand, requestJson, {});

    console.log(JSON.stringify({ emitted: contents.includes('"__proto__":'), ownsProto: Object.hasOwn(command.params.shape, "__proto__") }));
    expect(contents).toContain('"__proto__":');
    expect(Object.hasOwn(command.params.shape, "__proto__")).toBe(false);
  });
});
EOF
trap 'rm -f packages/toolcraft-openapi/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"emitted":true,"ownsProto":false}

✓ packages/toolcraft-openapi/src/__probe__.test.ts > OpenAPI generated __proto__ parameter > drops a valid parameter while evaluating generated command source
```

## Observed Behavior

`createCommandFile()` in `packages/toolcraft-openapi/src/generate.ts:1754` through `packages/toolcraft-openapi/src/generate.ts:1805` emits generated command parameter schemas using an object literal passed to `S.Object(...)`. `renderParamLines()` and `renderObjectKey()` at `packages/toolcraft-openapi/src/generate.ts:1893` through `packages/toolcraft-openapi/src/generate.ts:1907` and `packages/toolcraft-openapi/src/generate.ts:1968` through `packages/toolcraft-openapi/src/generate.ts:1974` serialize a parameter named `__proto__` as the literal source entry `"__proto__": S.String(...)`. In a JavaScript object literal, that key is treated specially rather than created as an own data property, so loading the generated module produces a command schema without the parameter that the generated file visibly declares.

This differs from the general `toolcraft-schema` declared-property validation report: here the OpenAPI generator creates source code that loses a valid spec parameter at module-construction time, before any runtime value validation occurs.

## Expected Behavior

Generated command modules should preserve every supported OpenAPI parameter name as an own schema key, including `__proto__`, or reject unsafe names during generation with a clear user-facing error. Source generation must not produce code that silently changes meaning when evaluated.

## Impact

OpenAPI specifications containing this legal parameter name generate commands with an incomplete public interface. Callers cannot supply or document the omitted parameter through generated CLI, MCP, or SDK commands, and the generated source misleadingly suggests that the field is supported even though the loaded command omits it.
