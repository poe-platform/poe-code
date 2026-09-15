import { expect, it, vi } from "vitest";
import { selectRequestProtocol, validateProtocolValue } from "./protocol.js";
const cache = { resultType: "complete", ttlMs: 0, cacheScope: "private" };

it.each(["bad key", "_private", "a/with/slash", "/name", "9prefix/name", "prefix-/name", "com..example/name", "prefix/_name", "name-", "nämé"])("rejects invalid metadata key %j in known results and request metadata", (key) => {
  expect(validateProtocolValue("ListToolsResult", { ...cache, tools: [], _meta: { [key]: true } })).toBe(false);
  const request = selectRequestProtocol("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, [key]: true } }, new Set());
  expect(request.error?.code).toBe(-32602);
});
it.each(["", "name", "Name9", "name_with.dots-and-hyphens", "com.example/name", "prefix/", "io.modelcontextprotocol/unknown"])("preserves valid metadata key %j including unknown reserved values", (key) => {
  expect(validateProtocolValue("ListToolsResult", { ...cache, tools: [], _meta: { [key]: { arbitrary: true } } })).toBe(true);
});
it("checks nested protocol metadata without interpreting structured content metadata", () => {
  expect(validateProtocolValue("CallToolResult", { resultType: "complete", content: [{ type: "text", text: "ready", _meta: { "bad key": true } }] })).toBe(false);
  expect(validateProtocolValue("CallToolResult", { resultType: "complete", content: [{ type: "text", text: "ready", resource: { _meta: { "bad key": true } } }], structuredContent: { _meta: { "bad key": true } } })).toBe(true);
});
it("asserts URI formats on icon descriptors", () => {
  expect(validateProtocolValue("ListToolsResult", { ...cache, tools: [{ name: "work", inputSchema: { type: "object" }, icons: [{ src: "not a URI" }] }] })).toBe(false);
});

it.each([true, false])("does not invoke metadata accessors during protocol selection: enumerable=%s", (enumerable) => {
  const getter = vi.fn(() => ({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} }));
  const params = Object.defineProperty({}, "_meta", { enumerable, get: getter });
  const selection = selectRequestProtocol("tools/list", params, new Set());
  expect(getter).not.toHaveBeenCalled();
  if (enumerable) expect(selection.error?.code).toBe(-32602);
  else expect(selection).toEqual({ modern: false });
});
