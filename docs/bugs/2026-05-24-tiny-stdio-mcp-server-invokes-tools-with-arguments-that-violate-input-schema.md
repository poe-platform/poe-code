# Tiny stdio MCP server invokes tools with arguments that violate input schema

## Summary

`tiny-stdio-mcp-server` advertises tool input schemas through `tools/list` but does not validate incoming `tools/call` arguments against those schemas. A caller can omit required fields and send values of the wrong type, and the registered handler is still invoked with the invalid object as though validation succeeded.

## Reproduction

From the repository root, run a disposable Vitest probe registering a tool with two required typed arguments and then call it with one missing field and one wrong-typed field:

```sh
cat > /tmp/tiny-stdio-mcp-unvalidated-args-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

describe("tiny stdio MCP argument validation", () => {
  it("invokes a tool with missing and wrongly typed required arguments despite its schema", async () => {
    const handler = vi.fn(async (args: { name: string; count: number }) => `${String(args.name)}:${String(args.count)}`);
    const server = createServer({ name: "probe", version: "1" }).tool(
      "run",
      "Run",
      defineSchema({ name: { type: "string" }, count: { type: "number" } }),
      handler
    );
    await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const result = await server.handleMessage("tools/call", { name: "run", arguments: { count: "many" } });
    console.log(JSON.stringify({ result, handlerArgs: handler.mock.calls[0]?.[0] }));
    expect(handler).toHaveBeenCalledWith({ count: "many" });
    expect(result).toMatchObject({ result: { content: [{ type: "text", text: "undefined:many" }] } });
  });
});
EOF
cp /tmp/tiny-stdio-mcp-unvalidated-args-probe.test.ts packages/tiny-stdio-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-stdio-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-stdio-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The tool handler receives `{ count: "many" }` despite `name` being required and `count` being declared numeric, and the server returns the handler's success response:

```text
{"result":{"result":{"content":[{"type":"text","text":"undefined:many"}]}},"handlerArgs":{"count":"many"}}
✓ packages/tiny-stdio-mcp-server/src/__probe__.test.ts > tiny stdio MCP argument validation > invokes a tool with missing and wrongly typed required arguments despite its schema
```

`packages/tiny-stdio-mcp-server/src/server.ts:101` through `packages/tiny-stdio-mcp-server/src/server.ts:110` expose each registered `inputSchema`, but `packages/tiny-stdio-mcp-server/src/server.ts:113` through `packages/tiny-stdio-mcp-server/src/server.ts:141` simply cast `params.arguments` and pass it to the handler without any schema check.

## Expected Behavior

Before invoking a tool handler, the server should validate call arguments against the same input schema it advertises and return an invalid-params error for missing required fields or incompatible types.

## Impact

Tool handlers receive untrusted data that violates their declared TypeScript and MCP contracts. Handlers can fail unexpectedly, perform actions with malformed values, or produce misleading success responses for requests that clients were told are invalid.
