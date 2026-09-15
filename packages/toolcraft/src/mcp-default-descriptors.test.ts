import { expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

it("omits non-JSON defaults from descriptors while preserving handler defaults", async () => {
  const callback = vi.fn(() => 42);
  const received = vi.fn();
  const command = defineCommand({
    name: "read", scope: ["mcp"],
    params: S.Object({ value: S.Object({ name: S.String() }, {
      additionalProperties: true, default: { name: "ready", callback }
    }) }),
    handler({ params }) { received(params); return "ready"; }
  });
  const session = createMCPServer(defineGroup({ name: "root", children: [command] }), {
    name: "root", version: "1", errorReports: false
  }).createMessageSession(() => undefined);
  try {
    await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    const listing = await session.handleMessage("tools/list");
    const tool = (listing.result as { tools: Array<{ inputSchema: { properties: { value: unknown } } }> }).tools[0]!;
    expect(tool.inputSchema.properties.value).not.toHaveProperty("default");
    expect(await session.handleMessage("tools/call", { name: "root__read", arguments: {} }))
      .toMatchObject({ result: { content: [{ type: "text", text: "ready" }] } });
    expect(received).toHaveBeenCalledWith({ value: { name: "ready", callback } });
    expect(callback).not.toHaveBeenCalled();
  } finally { session.close(); }
});
