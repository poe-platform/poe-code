import { expect, it } from "vitest";
import { validateServerResult } from "./protocol.js";
import { createServer } from "./index.js";
import { GetPromptResultSchema } from "@modelcontextprotocol/sdk/types.js";

it.each(["custom/work", "__proto__", "constructor", "toString"])("allows extension results for %s without inherited definition lookup", (method) => {
  expect(validateServerResult(method, { resultType: "complete", value: 1 })).toBe(true);
});

it("rejects malformed known results while retaining JSON scalar structured content", () => {
  expect(validateServerResult("tools/call", { resultType: "complete", content: [], structuredContent: 7 })).toBe(true);
  expect(validateServerResult("tools/call", { resultType: "complete", content: "wrong" })).toBe(false);
});

it("accepts resource links in modern and 2025-11-25 prompts", async () => {
  const content = { type: "resource_link", name: "document", uri: "file:///document" };
  const server = createServer({ name: "prompt-links", version: "1" }).prompt({ name: "document" }, () => ({ messages: [{ role: "user", content }] }) as never);
  const _meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
  expect(await server.handleMessage("prompts/get", { name: "document", _meta })).toMatchObject({ result: { resultType: "complete", messages: [{ content }] } });
  await server.handleMessage("initialize", { protocolVersion: "2025-11-25" });
  expect(GetPromptResultSchema.safeParse({ messages: [{ role: "user", content }] }).success).toBe(true);
  expect(await server.handleMessage("prompts/get", { name: "document" })).toMatchObject({ result: { messages: [{ content }] } });
});

it("isolates prompt resource-link support by the negotiated legacy connection version", async () => {
  const content = { type: "resource_link" as const, name: "document", uri: "file:///document" };
  const server = createServer({ name: "prompt-links", version: "1" }).prompt({ name: "document" }, () => ({ messages: [{ role: "user", content }] }));
  const older = server.createMessageSession();
  const newer = server.createMessageSession();
  try {
    await older.handleMessage("initialize", { protocolVersion: "2025-03-26" });
    await newer.handleMessage("initialize", { protocolVersion: "2025-11-25" });
    expect(await newer.handleMessage("prompts/get", { name: "document" })).toMatchObject({ result: { messages: [{ content }] } });
    expect(await older.handleMessage("prompts/get", { name: "document" })).toMatchObject({ error: { code: -32603 } });
    expect(await newer.handleMessage("prompts/get", { name: "document" })).toMatchObject({ result: { messages: [{ content }] } });
  } finally { older.close(); newer.close(); }
});
