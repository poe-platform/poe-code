# Toolcraft MCP Drops a Declared `__proto__` Parameter Before the Command Handler

## Summary

The public `toolcraft/mcp` server accepts an MCP request for a command schema that declares a `__proto__` parameter, but silently removes the validated value before invoking the command handler. Under the default snake-case MCP representation the client submits the advertised `proto` field, which is mapped back to the declared `__proto__` key and assigned into an ordinary result object.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe("toolcraft MCP prototype-key parameter repro", () => {
  it("drops a declared __proto__ tool parameter before invoking the handler", async () => {
    const handler = vi.fn(async ({ params }) => ({ hasProto: Object.hasOwn(params, "__proto__") }));
    const shape = Object.fromEntries([["__proto__", S.String()]]) as Record<string, ReturnType<typeof S.String>>;
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [defineCommand({ name: "probe", scope: ["mcp"], params: S.Object(shape), handler })]
      }),
      { name: "toolcraft-test", version: "1.0.0", omitRootToolNamePrefix: true }
    );
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({ clientInfo: { name: "test", version: "1.0.0" } })
    );

    try {
      await client.callTool({ name: "probe", arguments: { proto: "visible" } });
      const params = handler.mock.calls[0]?.[0].params as Record<string, unknown>;
      expect(params).toEqual({});
      expect(Object.hasOwn(params, "__proto__")).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the MCP tool call is accepted while the command handler receives no own field for its declared parameter. Remove the disposable probe after validation.

## Observed Behavior

A command with `params: S.Object(Object.fromEntries([["__proto__", S.String()]]))` is exposed through `createMCPServer()` under default snake-case argument naming, where the client submits `proto: "visible"`. The call succeeds, but the handler receives `params` equal to `{}` with no own `__proto__` property. In `packages/toolcraft/src/mcp.ts`, `validateObjectSchema()` maps each transport key back to its schema output key and writes it to `result = {}` via `result[outputKey] = ...`; for `outputKey === "__proto__"`, the accepted validated value is not retained before handler invocation.

## Expected Behavior

Toolcraft MCP validation should preserve a value for every accepted schema-declared parameter, including a declaration named `__proto__`, or reject such declarations when constructing the tool rather than advertising and accepting a field that is lost at execution time.

## Impact

Tool authors can publish a valid MCP command whose accepted request cannot be delivered faithfully to its handler. Clients receive no input-validation error, while business logic executes with missing parameters, potentially changing command results or bypassing intended checks that depend on the declared field.
