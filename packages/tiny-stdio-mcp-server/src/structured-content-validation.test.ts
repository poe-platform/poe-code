import { expect, it, vi } from "vitest";
import { createServer, defineSchema } from "./index.js";

it.each([NaN, Infinity, BigInt(1), undefined])("rejects a legacy non-JSON nested structured value %s", async (value) => {
  const server = createServer({ name: "results", version: "1" }).registerTool(
    { name: "json", inputSchema: defineSchema({}) },
    () => ({ content: [], structuredContent: { value } })
  );
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  expect(await server.handleMessage("tools/call", { name: "json" })).toMatchObject({
    result: { isError: true }
  });
});

it("rejects a hidden serialization hook without invoking it", async () => {
  const toJSON = vi.fn(() => "different wire value");
  const structuredContent = Object.defineProperty({ value: 1 }, "toJSON", { value: toJSON });
  const server = createServer({ name: "results", version: "1" }).registerTool(
    { name: "json", inputSchema: defineSchema({}) },
    () => ({ content: [], structuredContent })
  );
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  expect(await server.handleMessage("tools/call", { name: "json" })).toMatchObject({ result: { isError: true } });
  expect(toJSON).not.toHaveBeenCalled();
});

it("preserves nested JSON values and shared references without treating them as cycles", async () => {
  const shared = { optional: null, fraction: 0.5, list: [false, "value"] };
  const structuredContent = { first: shared, second: shared };
  const server = createServer({ name: "results", version: "1" }).registerTool(
    { name: "json", inputSchema: defineSchema({}) },
    () => ({ content: [], structuredContent })
  );
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  expect(await server.handleMessage("tools/call", { name: "json" })).toMatchObject({ result: { structuredContent } });
});

it.each([undefined, BigInt(1)])("reports invalid declared structured outputs as protocol errors %s", async (value) => {
  const server = createServer({ name: "results", version: "1" }).registerTool(
    { name: "json", inputSchema: defineSchema({}), outputSchema: defineSchema({ values: { type: "array", items: { type: "string" } } }) },
    () => ({ content: [], structuredContent: { values: [value] } })
  );
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  expect(await server.handleMessage("tools/call", { name: "json" })).toMatchObject({ error: { code: -32603 } });
});
