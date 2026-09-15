import { expect, it } from "vitest";
import { validateModernHeaders } from "./modern-headers.js";

const request = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { name: "世界", _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }
};
const headers = {
  "mcp-protocol-version": "2026-07-28",
  "mcp-method": "tools/call",
  "mcp-name": "=?base64?5LiW55WM?="
};

it("decodes UTF-8 Base64 names before comparison", () => {
  expect(validateModernHeaders(headers, request)).toBeUndefined();
});
it.each([
  "=?base64?%%%?=",
  "=?base64?/w==?=",
  "世界",
  "=?BASE64?5LiW55WM?=",
  "=?base64?5LiW55WM?=garbage",
  [headers["mcp-name"], headers["mcp-name"]]
])("rejects malformed or duplicate name header %j", (name) => {
  expect(validateModernHeaders({ ...headers, "mcp-name": name }, request)).toMatchObject({
    code: -32020
  });
});
it.each(["mcp-name", "mcp-method", "mcp-protocol-version"])("rejects missing %s", (field) => {
  const values = { ...headers } as Record<string, string>;
  delete values[field];
  expect(validateModernHeaders(values, request)).toMatchObject({ code: -32020 });
});
