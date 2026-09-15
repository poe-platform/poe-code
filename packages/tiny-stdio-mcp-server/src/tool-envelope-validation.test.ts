import { expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

it.each(["string", "array", "boolean", "number"])(
  "rejects input schemas with a %s root at registration",
  (type) => {
    const server = createServer({ name: "validation", version: "1" });
    expect(() =>
      server.registerTool({ name: "invalid", inputSchema: { type } as never }, () => "done")
    ).toThrow('inputSchema root type must be "object"');
  }
);

it.each([true, false])(
  "rejects malformed tool argument containers with validateToolArguments=%s",
  async (validateToolArguments) => {
    const server = createServer({ name: "validation", version: "1", validateToolArguments });
    const handler = vi.fn(() => "done");
    server.tool("check", "Check", defineSchema({}), handler);
    await server.handleMessage("initialize", {});
    for (const argumentsValue of [null, [], "value", 123, true]) {
      expect(
        await server.handleMessage("tools/call", { name: "check", arguments: argumentsValue })
      ).toMatchObject({ error: { code: -32602 } });
    }
    expect(handler).not.toHaveBeenCalled();
  }
);
