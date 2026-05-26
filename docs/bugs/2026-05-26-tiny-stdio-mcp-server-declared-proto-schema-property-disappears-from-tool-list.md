# Tiny stdio MCP server declared proto schema property disappears from tool list

## Summary

The exported `tiny-stdio-mcp-server` `defineSchema()` helper cannot faithfully publish a tool input property named `__proto__`. When a tool schema declares a required `__proto__` string field, `tools/list` advertises `required: ["__proto__"]` but returns an empty `properties` object, producing a contradictory public JSON Schema that requires a parameter without describing it.

## Reproduction

Create the disposable probe `packages/tiny-stdio-mcp-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createServer } from "./server.js";
import { defineSchema } from "./schema.js";

describe("stdio MCP schema special key", () => {
  it("drops a declared __proto__ input property from advertised tools", async () => {
    const definition = Object.fromEntries([
      ["__proto__", { type: "string" as const, description: "visible" }]
    ]);
    const schema = defineSchema(definition);
    const server = createServer({ name: "probe", version: "1.0.0" });
    server.tool("submit", "submit", schema, () => "ok");
    await server.handleMessage("initialize", { protocolVersion: "2025-03-26" });

    const list = await server.handleMessage("tools/list");
    const advertised = (list.result as {
      tools: Array<{ inputSchema: { properties?: Record<string, unknown>; required?: string[] } }>;
    }).tools[0]!.inputSchema;

    console.log(JSON.stringify(advertised));
    expect(advertised.required).toContain("__proto__");
    expect(Object.hasOwn(advertised.properties ?? {}, "__proto__")).toBe(false);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints:

```text
{"type":"object","properties":{},"required":["__proto__"]}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > stdio MCP schema special key > drops a declared __proto__ input property from advertised tools
```

`defineSchema()` creates its published `properties` map as an ordinary `{}` and stores every declaration with dynamic assignment at `packages/tiny-stdio-mcp-server/src/schema.ts:39` through `packages/tiny-stdio-mcp-server/src/schema.ts:59`. Assigning the accepted key `__proto__` changes that object’s prototype instead of creating an own JSON Schema property, while the separate `required.push(key)` path still records the required name. The MCP server then exposes the damaged schema unchanged from `tools/list` at `packages/tiny-stdio-mcp-server/src/server.ts:101` through `packages/tiny-stdio-mcp-server/src/server.ts:110`.

## Expected Behavior

`defineSchema()` should preserve every declared input property as an own JSON Schema member, including `__proto__`, or reject unsupported property names clearly before registering a tool. A tool must not advertise a required input field that is absent from its own `properties` description.

## Impact

MCP clients, agents, and schema-driven UI generators can receive a malformed tool contract from a valid server definition. They may be unable to construct the required request, omit an apparently undocumented field, reject the tool schema entirely, or display misleading input forms for operations whose accepted source definition includes prototype-sensitive property names.
