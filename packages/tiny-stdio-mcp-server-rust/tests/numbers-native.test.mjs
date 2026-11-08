import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

test("tool number text and JSON fallbacks match JavaScript shortest binary64 spelling", async () => {
  for (const modern of [false, true]) {
    const native = createServer({ name: "test", version: "0" });
    const reference = referenceCreateServer({ name: "test", version: "0" });
    let value;
    for (const server of [native, reference]) {
      server.tool("number", "Number", { type: "object" }, () => value);
      server.tool("mixed", "Mixed", { type: "object" }, () => [value, [value], { number: value }]);
      server.registerTool(
        {
          name: "structured",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { number: { type: "number" } } }
        },
        () => ({ number: value })
      );
      server.registerTool(
        {
          name: "scalar-schema",
          inputSchema: { type: "object" },
          outputSchema: { type: "number" }
        },
        () => value
      );
      await server.handleMessage("initialize");
    }
    for (value of [
      0,
      -0,
      1e-7,
      -1e-7,
      1e-6,
      1e20,
      1e21,
      -1e21,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      Number("2140888806576048.25")
    ]) {
      for (const name of ["number", "mixed", "structured", "scalar-schema"]) {
        const params = {
          name,
          ...(modern
            ? {
                _meta: {
                  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                  "io.modelcontextprotocol/clientCapabilities": {}
                }
              }
            : {})
        };
        assert.deepEqual(
          await native.handleMessage("tools/call", params),
          await reference.handleMessage("tools/call", params),
          `${name}: ${value}`
        );
      }
    }
  }
});
