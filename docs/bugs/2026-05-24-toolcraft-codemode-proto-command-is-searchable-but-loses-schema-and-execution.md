# Toolcraft codemode proto command is searchable but loses schema and execution

## Summary

A valid SDK-scoped Toolcraft command named `__proto__` remains callable through the regular SDK as the normalized member `proto`, but `toolcraft-codemode` mishandles that special property name. Codemode search advertises the command, `get_schemas` silently returns an empty object for it, and neither the raw advertised export name nor the normalized SDK member name can be executed.

## Reproduction

From the repository root, run a disposable Vitest probe comparing direct SDK invocation to codemode discovery, schema lookup, and execution:

```sh
cat > /tmp/toolcraft-codemode-proto-command-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode __proto__ command", () => {
  it("searches an SDK-callable command while losing its schema and callable export", async () => {
    const root = defineGroup({
      name: "ops",
      children: [defineCommand({ name: "__proto__", description: "proto command", scope: ["sdk"], params: S.Object({}), handler: async () => "called" })]
    });
    const directSdk = createSDK(root) as { proto(params: Record<string, never>): Promise<string> };
    const codeSdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full" }): Promise<Array<{ path: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, unknown>>;
      execute(input: { source: string }): Promise<unknown>;
    };
    const direct = await directSdk.proto({});
    const search = await codeSdk.search({ query: "proto", detail: "full" });
    const schemas = await codeSdk.getSchemas({ names: ["__proto__"] });
    const rawExport = await codeSdk.execute({ source: 'import { __proto__ as invoke } from "ops";\nreturn await invoke({});' });
    const sdkExport = await codeSdk.execute({ source: 'import { proto as invoke } from "ops";\nreturn await invoke({});' });
    console.log(JSON.stringify({ direct, search, schemas, rawExport, sdkExport }));
    expect(direct).toBe("called");
    expect(search.map((entry) => entry.path)).toEqual(["__proto__"]);
    expect(schemas).toEqual({});
    expect(rawExport).toMatchObject({ ok: false, kind: "runtime", error: { message: "Attempted to call a non-function value." } });
    expect(sdkExport).toMatchObject({ ok: false, kind: "lint", diagnostics: [{ message: "Module 'ops' does not export 'proto'. Available exports: __proto__." }] });
  });
});
EOF
cp /tmp/toolcraft-codemode-proto-command-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The ordinary Toolcraft SDK successfully invokes the command, while codemode advertises it without returning its schema or exposing a callable script binding:

```text
{"direct":"called","search":[{"path":"__proto__","description":"proto command","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{},"rawExport":{"ok":false,"kind":"runtime","error":{"message":"Attempted to call a non-function value.","stack":"TypeError: Attempted to call a non-function value."}},"sdkExport":{"ok":false,"kind":"lint","diagnostics":[{"code":"AS005","severity":"error","message":"Module 'ops' does not export 'proto'. Available exports: __proto__.","filename":"<execute>","line":1,"column":10,"span":{"start":{"line":1,"column":10,"offset":9},"end":{"line":1,"column":15,"offset":14}}}]}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode __proto__ command > searches an SDK-callable command while losing its schema and callable export
```

`packages/toolcraft-codemode/src/get-schemas.ts:46` through `packages/toolcraft-codemode/src/get-schemas.ts:63` build a plain `{}` result and assign `result[name]`, so assignment at the magic `__proto__` key changes the prototype instead of creating an own returned schema property. Similarly, `packages/toolcraft-codemode/src/host-modules.ts:134` through `packages/toolcraft-codemode/src/host-modules.ts:143` build plain object module exports with the raw command name, while the Toolcraft SDK normalizes the valid command name to `proto` for direct execution.

## Expected Behavior

Codemode should preserve the usable identity of any command accepted by the Toolcraft SDK, including special property names. Schema results and module export tables should store such keys safely, and execution should expose a callable binding consistent with SDK normalization.

## Impact

An SDK-valid command becomes partially visible but unusable through codemode: models can discover it, cannot retrieve its parameters, and cannot invoke it. The special-key assignment also mutates the returned result object's prototype rather than representing the requested schema as data.
