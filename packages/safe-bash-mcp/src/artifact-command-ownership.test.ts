import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpCommands, generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

async function artifact() {
  return (await generateRemoteMcpArtifact(initRemoteMcpConfiguration([{
    name: "catalog", url: "https://catalog.example/mcp", protocolVersion: "2025-03-26",
    auth: { type: "oauth", clientMode: "static", env: { clientId: "APP_ID" } },
    tools: [{ name: "find", inputSchema: { type: "object", properties: {
      query: { type: "string", default: "005930", format: "original-id" }
    }, required: ["query"] } }]
  }]).configuration)).artifact;
}

function resource() {
  return vi.fn<HttpTransportFetch>(async (_url, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const request = JSON.parse(String(init?.body));
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "original", version: "1" } }
      : { content: [{ type: "text", text: "complete" }], structuredContent: request.params.arguments, _meta: { exact: "005930" } };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
}

it.each((["command", "recreation"] as const).flatMap(route => (["yes", "maxInputBytes", "maxOutputBytes"] as const).map(field => ({ route, field }))))(
  "retains hidden command $field through $route", async ({ route, field }) => {
    const fetch = resource(), commands = { fetch, yes: true, maxInputBytes: field === "maxInputBytes" ? 1 : 4096, maxOutputBytes: field === "maxOutputBytes" ? 1 : 4096 };
    Object.defineProperty(commands, field, { enumerable: false });
    const generated = await artifact(), shell = new Shell({ fs: createMemoryFileSystem(), ...(route === "command" ? {
      commands: new CommandRegistry(await createRemoteMcpCommands([{ name: "catalog", url: "https://catalog.example/mcp", protocolVersion: "2025-03-26", tools: generated.schemas[0].tools }], commands))
    } : {}) });
    try {
      if (route === "recreation") shell.use(await remoteMcpArtifactPlugin(generated, { binding: { env: { APP_ID: "original-app" }, oauth: { sessionStore: () => ({ load: async () => null, save: async () => {}, clear: async () => {} }) } }, commands }));
      const result = await shell.exec(field === "yes" ? "catalog find" : "catalog find --query 005930");
      if (field === "yes") { expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).structuredContent).toEqual({ query: "005930" }); }
      else { expect(result.exitCode).not.toBe(0); expect(result.stdout).toBe(""); }
      if (field === "maxInputBytes") expect(fetch).not.toHaveBeenCalled(); else expect(fetch).toHaveBeenCalled();
    } finally { await shell.dispose(); }
  }
);

it.each(["fetch", "input limit", "output limit", "response limit", "formats"] as const)(
  "captures artifact command %s before credential binding callbacks", async mutation => {
    const original = resource(), replacement = vi.fn<HttpTransportFetch>(() => { throw new Error("replacement fetch selected"); });
    const formats = { "original-id": (value: string) => value === "005930" };
    const commands = {
      fetch: original, maxInputBytes: 4096, maxOutputBytes: 4096, maxResponseBytes: 4096, schemaValidation: { formats }
    };
    const binding = { env: { APP_ID: "original-client" }, oauth: { sessionStore() {
      if (mutation === "fetch") commands.fetch = replacement;
      if (mutation === "input limit") commands.maxInputBytes = 1;
      if (mutation === "output limit") commands.maxOutputBytes = 1;
      if (mutation === "response limit") commands.maxResponseBytes = 1;
      if (mutation === "formats") formats["original-id"] = () => false;
      return { load: async () => null, save: async () => {}, clear: async () => {} };
    } } };
    const shell = new Shell({ fs: createMemoryFileSystem() });
    try {
      shell.use(await remoteMcpArtifactPlugin(await artifact(), { binding, commands }));
      const result = await shell.exec("catalog find --query 005930");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ content: [{ type: "text", text: "complete" }], structuredContent: { query: "005930" }, _meta: { exact: "005930" } });
      expect(replacement).not.toHaveBeenCalled();
      expect(original.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
    } finally { await shell.dispose(); }
  }
);

it("does not enable artifact defaults from a credential binding callback", async () => {
  const fetch = resource(), commands = { fetch, yes: false };
  const binding = { env: { APP_ID: "original-client" }, oauth: { sessionStore() {
    commands.yes = true;
    return { load: async () => null, save: async () => {}, clear: async () => {} };
  } } };
  const shell = new Shell({ fs: createMemoryFileSystem() });
  try {
    shell.use(await remoteMcpArtifactPlugin(await artifact(), { binding, commands }));
    const result = await shell.exec("catalog find");
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("query");
    expect(fetch).not.toHaveBeenCalled();
  } finally { await shell.dispose(); }
});

it("retains original artifact cancellation when binding replaces its handle", async () => {
  const controller = new AbortController(), reason = new Error("original artifact canceled");
  const fetch = resource(), commands = { fetch, signal: controller.signal };
  const binding = { env: { APP_ID: "original-client" }, oauth: { sessionStore() {
    commands.signal = new AbortController().signal;
    controller.abort(reason);
    return { load: async () => null, save: async () => {}, clear: async () => {} };
  } } };
  await expect(remoteMcpArtifactPlugin(await artifact(), { binding, commands })).rejects.toBe(reason);
  expect(fetch).not.toHaveBeenCalled();
});
