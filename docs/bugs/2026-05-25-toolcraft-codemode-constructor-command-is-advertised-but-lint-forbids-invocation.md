# Toolcraft codemode constructor command is advertised but lint forbids invocation

## Summary

`toolcraft-codemode` advertises an SDK-scoped command named `constructor` through `search` and `get_schemas`, even though its `execute` tool cannot invoke that command. The underlying Toolcraft SDK accepts and runs the declared command, but codemode requires source access through `ops.constructor(...)`, which agent-script lint rejects as forbidden property access.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-codemode/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";

describe("codemode constructor command", () => {
  it("advertises a declared constructor command that execute cannot invoke", async () => {
    const root = defineGroup({
      name: "ops",
      children: [defineCommand({ name: "constructor", description: "declared constructor tool", scope: ["sdk"], params: S.Object({}), handler: async () => "called" })]
    });
    const direct = createSDK(root) as { constructor(input: object): Promise<string> };
    const sdk = createSDK(codeMode(root)) as {
      search(input: { query: string; detail: "full" }): Promise<Array<{ path: string }>>;
      getSchemas(input: { names: string[] }): Promise<Record<string, unknown>>;
      execute(input: { source: string }): Promise<unknown>;
    };

    const result = {
      direct: await direct.constructor({}),
      search: await sdk.search({ query: "constructor", detail: "full" }),
      schemas: await sdk.getSchemas({ names: ["constructor"] }),
      execution: await sdk.execute({ source: 'import * as ops from "ops";\nreturn await ops.constructor({});' })
    };
    console.log(JSON.stringify(result));
    expect(result.direct).toBe("called");
    expect(result.search.map((entry) => entry.path)).toEqual(["constructor"]);
    expect(result.schemas).toHaveProperty("constructor");
    expect(result.execution).toMatchObject({ ok: false });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-codemode/src/__probe__.test.ts
```

## Observed Behavior

The direct SDK invokes the command successfully and codemode advertises it, but execution fails during linting:

```text
{"direct":"called","search":[{"path":"constructor","description":"declared constructor tool","schema":{"type":"object","properties":{},"required":[]}}],"schemas":{"constructor":{"description":"declared constructor tool","params":{"type":"object","properties":{},"required":[]}}},"execution":{"ok":false,"kind":"lint","diagnostics":[{"code":"AS011","severity":"error","message":"Property access to '__proto__', 'prototype', and 'constructor' is not allowed."}]}}
```

`resolveCommandTree()` in `packages/toolcraft-codemode/src/tree.ts:49` includes any programmatic command and publishes its raw name as a codemode path, so `constructor` is included in discovery. `makeGetSchemasCommand()` in `packages/toolcraft-codemode/src/get-schemas.ts:42` returns the command's schema without excluding commands that cannot be expressed in executable agent-script. `makeExecuteCommand()` in `packages/toolcraft-codemode/src/execute.ts:130` then lints submitted source before runtime execution; the required access form `ops.constructor({})` is rejected by agent-script with diagnostic `AS011`.

## Expected Behavior

Commands exposed as callable through codemode discovery and schema lookup should be executable through codemode's `execute` tool. If reserved property names such as `constructor` cannot safely be invoked by agent-script, codemode should reject or omit those commands consistently rather than advertise an unusable tool surface.

## Impact

Toolcraft command groups that legitimately define a `constructor` command expose misleading codemode capabilities: models can discover the command and obtain valid input schema, but every compliant invocation is rejected before the handler runs. This wastes agent iterations and makes codemode an incomplete adapter for otherwise functional SDK command trees.
