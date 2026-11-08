import { expect, it } from "vitest";
import { createServer, defineSchema } from "./index.js";
import type { Tool } from "./index.js";

it.each(["tool", "registerTool"] as const)("%s snapshots schemas before compiling validators", async (registration) => {
  const inputSchema = defineSchema({ value: { type: "string" } });
  const outputSchema = defineSchema({ echo: { type: "string" } });
  const server = createServer({ name: "snapshots", version: "1" });
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  const handler = (args: { value: string }) => ({ echo: args.value });
  if (registration === "tool") server.tool("echo", "Echo", inputSchema, handler, outputSchema);
  else server.registerTool({ name: "echo", inputSchema, outputSchema }, handler);
  inputSchema.properties!.value!.type = "number";
  outputSchema.properties!.echo!.type = "number";
  expect(await server.handleMessage("tools/list")).toMatchObject({
    result: { tools: [{ inputSchema: { properties: { value: { type: "string" } } },
      outputSchema: { properties: { echo: { type: "string" } } } }] }
  });
  expect(await server.handleMessage("tools/call", { name: "echo", arguments: { value: "original" } })).toMatchObject({
    result: { structuredContent: { echo: "original" } }
  });
});

it("isolates list results from private tool schemas and nested metadata", async () => {
  const server = createServer({ name: "snapshots", version: "1" });
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  server.registerTool({ name: "echo", inputSchema: defineSchema({ value: { type: "string" } }),
    outputSchema: defineSchema({ echo: { type: "string" } }),
    icons: [{ src: "https://example.com/original.png" }],
    _meta: { "example.com/details": { value: "original" } }
  }, (args: { value: string }) => ({ echo: args.value }));
  const first = await server.handleMessage("tools/list");
  const tool = (first.result as { tools: Tool[] }).tools[0]!;
  tool.inputSchema.properties!.value!.type = "number";
  (tool.outputSchema!.properties as Record<string, { type: string }>).echo!.type = "number";
  tool.icons![0]!.src = "https://example.com/changed.png";
  (tool._meta!["example.com/details"] as { value: string }).value = "changed";
  expect(await server.handleMessage("tools/list")).toMatchObject({
    result: { tools: [{ inputSchema: { properties: { value: { type: "string" } } },
      icons: [{ src: "https://example.com/original.png" }],
      _meta: { "example.com/details": { value: "original" } }
    }] }
  });
  expect(await server.handleMessage("tools/call", { name: "echo", arguments: { value: "original" } })).toMatchObject({
    result: { structuredContent: { echo: "original" } }
  });
});
