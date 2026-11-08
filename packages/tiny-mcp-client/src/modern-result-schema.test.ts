import { expect, it } from "vitest";
import { createInMemoryTransportPair, JsonRpcMessageLayer, McpClient } from "./internal.js";

const cache = { resultType: "complete", ttlMs: 0, cacheScope: "private" };
const cases = [
  { name: "prompt containers", method: "prompts/list", result: { ...cache, prompts: "wrong" }, invoke: (client: McpClient) => client.listPrompts() },
  { name: "prompt argument metadata", method: "prompts/list", result: { ...cache, prompts: [{ name: "prompt", arguments: [{ name: "value", required: "wrong" }] }] }, invoke: (client: McpClient) => client.listPrompts() },
  { name: "tool annotations", method: "tools/list", result: { ...cache, tools: [{ name: "work", inputSchema: { type: "object" }, annotations: { readOnlyHint: "wrong" } }] }, invoke: (client: McpClient) => client.listTools() },
  { name: "tool output schema containers", method: "tools/list", result: { ...cache, tools: [{ name: "work", inputSchema: { type: "object" }, outputSchema: "wrong" }] }, invoke: (client: McpClient) => client.listTools() },
  { name: "resource annotations", method: "resources/list", result: { ...cache, resources: [{ name: "value", uri: "file:///value", annotations: { priority: 2 } }] }, invoke: (client: McpClient) => client.listResources() },
  { name: "resource template icons", method: "resources/templates/list", result: { ...cache, resourceTemplates: [{ name: "value", uriTemplate: "file:///{value}", icons: "wrong" }] }, invoke: (client: McpClient) => client.listResourceTemplates() },
  { name: "completion capacity", method: "completion/complete", result: { resultType: "complete", completion: { values: Array.from({ length: 101 }, () => "value") } }, invoke: (client: McpClient) => client.complete({ ref: { type: "ref/prompt", name: "prompt" }, argument: { name: "value", value: "a" } }) }
];

it.each([
  { method: "resources/list", result: { ...cache, resources: [{ name: "bad", uri: "not a URI" }] }, invoke: (client: McpClient) => client.listResources() },
  { method: "resources/read", result: { ...cache, contents: [{ uri: "not a URI", text: "bad" }] }, invoke: (client: McpClient) => client.readResource({ uri: "file:///bad" }) },
  { method: "tools/call", result: { resultType: "complete", content: [{ type: "resource_link", name: "bad", uri: "not a URI" }] }, invoke: (client: McpClient) => client.callTool({ name: "bad" }) },
  { method: "tools/call", result: { resultType: "complete", content: [{ type: "resource", resource: { uri: "not a URI", text: "bad" } }] }, invoke: (client: McpClient) => client.callTool({ name: "bad" }) },
  { method: "prompts/get", result: { resultType: "complete", messages: [{ role: "user", content: { type: "resource_link", name: "bad", uri: "not a URI" } }] }, invoke: (client: McpClient) => client.getPrompt({ name: "bad" }) }
])("rejects invalid resource URIs in $method results", async ({ method, result, invoke }) => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  server.onRequest("server/discover", () => ({ ...cache, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, prompts: {}, resources: {} } }));
  server.onRequest(method, () => result);
  const client = new McpClient({ clientInfo: { name: "uri", version: "1" } });
  try { await client.connect(pair.clientTransport); await expect(invoke(client)).rejects.toMatchObject({ code: -32600 }); }
  finally { await client.close(); server.dispose(); }
});

it.each(cases)("rejects malformed modern $name before exposing results", async ({ method, result, invoke }) => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "schema-check", version: "1" } });
  server.onRequest("server/discover", () => ({ ...cache, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, resources: {}, prompts: {}, completions: {} } }));
  server.onRequest(method, () => result);
  try {
    await client.connect(pair.clientTransport);
    await expect(invoke(client)).rejects.toMatchObject({ code: -32600 });
  } finally { server.dispose(); pair.clientTransport.dispose(); }
});

it.each(["tools/call", "prompts/get"])("accepts modern resource links in %s content", async (method) => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "links", version: "1" } });
  const link = { type: "resource_link", name: "document", uri: "file:///document", description: "Document reference" };
  server.onRequest("server/discover", () => ({ ...cache, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, prompts: {} } }));
  server.onRequest(method, () => method === "tools/call" ? { resultType: "complete", content: [link] } : { resultType: "complete", messages: [{ role: "user", content: link }] });
  try {
    await client.connect(pair.clientTransport);
    if (method === "tools/call") await expect(client.callTool({ name: "link" })).resolves.toMatchObject({ content: [link] });
    else await expect(client.getPrompt({ name: "link" })).resolves.toMatchObject({ messages: [{ content: link }] });
  } finally { server.dispose(); pair.clientTransport.dispose(); }
});

it.each([
  { method: "tools/call", result: { resultType: "complete", content: [{ type: "image", mimeType: "image/png", data: "%%%%" }] }, invoke: (client: McpClient) => client.callTool({ name: "bad-image" }) },
  { method: "prompts/get", result: { resultType: "complete", messages: [{ role: "user", content: { type: "audio", mimeType: "audio/wav", data: "%%%%" } }] }, invoke: (client: McpClient) => client.getPrompt({ name: "bad-audio" }) },
  { method: "resources/read", result: { ...cache, contents: [{ uri: "file:///binary", blob: "%%%%" }] }, invoke: (client: McpClient) => client.readResource({ uri: "file:///binary" }) },
  { method: "tools/call", result: { resultType: "complete", content: [{ type: "resource", resource: { uri: "file:///binary", blob: "%%%%" } }] }, invoke: (client: McpClient) => client.callTool({ name: "bad-blob" }) }
])("rejects invalid base64 in $method binary content", async ({ method, result, invoke }) => {
  const pair = createInMemoryTransportPair();
  const server = new JsonRpcMessageLayer(pair.serverTransport.readable, pair.serverTransport.writable);
  const client = new McpClient({ clientInfo: { name: "binary-check", version: "1" } });
  server.onRequest("server/discover", () => ({ ...cache, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, prompts: {}, resources: {} } }));
  server.onRequest(method, () => result);
  try {
    await client.connect(pair.clientTransport);
    await expect(invoke(client)).rejects.toMatchObject({ code: -32600 });
  } finally { server.dispose(); pair.clientTransport.dispose(); }
});
