import { expect, it, vi } from "vitest";

vi.mock("node:readline", () => { throw new Error("Protocol core imported Node readline"); });
vi.mock("node:stream", () => { throw new Error("Protocol core imported Node streams"); });

import { createProtocolServer, defineSchema } from "./core.js";

it("allows module-scope registration when the runtime only permits request-scoped controllers", () => {
  const abortController = vi.spyOn(globalThis, "AbortController").mockImplementation(function () {
    throw new Error("Disallowed operation called within global scope");
  });
  try {
    expect(() => createProtocolServer({ name: "worker", version: "1" })
      .tool("echo", "Echo", defineSchema({}), () => "ok")).not.toThrow();
  } finally {
    abortController.mockRestore();
  }
});

it("runs typed tools with host-only context without loading a stdio transport", async () => {
  const server = createProtocolServer({ name: "core", version: "1" })
    .tool("identity", "Identity", defineSchema({}), (_, context) => {
      return (context.localContext as { userId: string }).userId;
    });
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  const result = await server.handleMessage("tools/call", {
    name: "identity", arguments: {}, _meta: { localContext: { userId: "victim" } }
  }, { localContext: { userId: "alice" } });
  expect(result).toMatchObject({ result: { content: [{ type: "text", text: "alice" }] } });
});
