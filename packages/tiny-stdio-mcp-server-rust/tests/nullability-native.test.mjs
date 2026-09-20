import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/index.js";
import { createServer as referenceCreateServer } from "tiny-stdio-mcp-server";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

test("tool registrations normalize nullable input/output schemas and retain normalized snapshots", async () => {
  const inputSchema = {
    type: "object",
    properties: {
      value: { type: "integer", nullable: true },
      mirrored: { $ref: "#/properties/value" }
    },
    required: ["value"]
  };
  for (const shorthand of [false, true])
    for (const modern of [false, true]) {
      for (const outputSchema of [
        { type: "integer", nullable: true },
        {
          type: "object",
          properties: { value: { type: "integer", nullable: true } },
          required: ["value"]
        },
        { type: "object", nullable: true, properties: { value: { type: "integer" } } }
      ]) {
        const servers = [
          createServer({ name: "test", version: "1" }),
          referenceCreateServer({ name: "test", version: "1" })
        ];
        const calls = [0, 0];
        for (let index = 0; index < servers.length; index++) {
          const handler = (args) => {
            calls[index]++;
            return args.value;
          };
          const input = structuredClone(inputSchema);
          const output = structuredClone(outputSchema);
          if (shorthand) servers[index].tool("nullable", "Nullable", input, handler, output);
          else
            servers[index].registerTool(
              {
                name: "nullable",
                description: "Nullable",
                inputSchema: input,
                outputSchema: output
              },
              handler
            );
          input.properties.value.type = "boolean";
          output.nullable = false;
          if (!modern) await servers[index].handleMessage("initialize");
        }
        const meta = modern ? { _meta: metadata } : {};
        assert.deepEqual(
          await servers[0].handleMessage("tools/list", meta),
          await servers[1].handleMessage("tools/list", meta)
        );
        for (const args of [
          { value: null, mirrored: null },
          { value: 7 },
          { value: "wrong" },
          { value: { value: null } },
          {}
        ]) {
          const params = { name: "nullable", arguments: args, ...meta };
          assert.deepEqual(
            await servers[0].handleMessage("tools/call", params),
            await servers[1].handleMessage("tools/call", params)
          );
          assert.equal(calls[0], calls[1]);
        }
      }
    }
});

test("normalized nullable root inputs and unreachable header annotations reject atomically", async () => {
  for (const inputSchema of [
    { type: "object", nullable: true },
    {
      type: "object",
      properties: { value: { type: "string", nullable: true, "x-mcp-header": "Value" } }
    }
  ]) {
    const servers = [
      createServer({ name: "test", version: "1" }),
      referenceCreateServer({ name: "test", version: "1" })
    ];
    let expected;
    try {
      servers[1].registerTool({ name: "invalid", inputSchema }, () => "bad");
    } catch (error) {
      expected = error.message;
    }
    assert.ok(expected);
    assert.throws(() => servers[0].registerTool({ name: "invalid", inputSchema }, () => "bad"), {
      message: expected
    });
    assert.deepEqual(
      await servers[0].handleMessage("tools/list", { _meta: metadata }),
      await servers[1].handleMessage("tools/list", { _meta: metadata })
    );
  }
});
