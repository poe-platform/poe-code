import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { fetchRemoteMcpSchema, resolveRemoteMcpSchemas, createRemoteMcpCommands, accessRemoteMcpResources,
  initRemoteMcpConfiguration, authenticateRemoteMcpServer, generateRemoteMcpArtifact, remoteMcpArtifactPlugin,
  createRemoteMcpManagementCommand, type SchemaFetchOptions } from "./index.js";
const url = "https://resource.example/mcp";
const tools = ["echo", "second"].map(name => ({ name, inputSchema: { type: "object" } }));
const server = { name: "catalog", url, protocolVersion: "2025-03-26" as const };
const routes = ["schema", "registry", "command", "resource", "auth", "generation", "recreation", "management-generation", "management-resource", "management-auth"] as const;
it.each(routes.flatMap(route => (["signal", "fetch", "requestTimeoutMs", "maxResponseBytes", "maxTools", "maxPages"] as const).map(field => ({ route, field }))))(
  "retains hidden schema option $field through $route", async ({ route, field }) => {
    const reason = new Error("original schema cancellation"), ambient = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Ambient fetch selected"));
    const fetch = vi.fn(async (_target: string | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? {
        protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" }, instructions: "complete guidance"
      } : rpc.method === "tools/list" ? { tools } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "complete005930" }] }
        : { contents: [{ uri: "memo://005930", text: "complete" }] } }, { headers: { "Mcp-Session-Id": "owned" } });
    });
    const options: SchemaFetchOptions = { fetch, signal: field === "signal" ? AbortSignal.abort(reason) : undefined,
      requestTimeoutMs: field === "requestTimeoutMs" ? 0 : 1000, maxResponseBytes: field === "maxResponseBytes" ? 1 : 4096,
      maxTools: field === "maxTools" ? 0 : 100, maxPages: field === "maxPages" ? 0 : 100 };
    Object.defineProperty(options, field, { enumerable: false });
    const expected = field === "fetch" ? undefined : field === "signal" ? reason.message : field === "maxResponseBytes" ? "1 bytes" : field;
    const execute = async (command: Awaited<ReturnType<typeof createRemoteMcpCommands>>[number], args: string) => {
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([command]) });
      try { const result = await shell.exec(args); if (result.exitCode !== 0) throw new Error(result.stderr); return result; }
      finally { await shell.dispose(); }
    };
    const run = async () => {
      if (route === "schema") return fetchRemoteMcpSchema(server, options);
      if (route === "registry") return resolveRemoteMcpSchemas([server], options);
      if (route === "command") return execute((await createRemoteMcpCommands([{ ...server, tools }], options))[0], "catalog echo");
      if (route === "resource") return accessRemoteMcpResources({ ...server, tools }, { operation: "read", uri: "memo://005930" }, options);
      const configuration = initRemoteMcpConfiguration([{ ...server, tools }]).configuration;
      if (route === "auth") return authenticateRemoteMcpServer(configuration.servers[0], Object.defineProperties({ binding: { env: {} }, ...options }, Object.getOwnPropertyDescriptors(options)));
      if (route === "generation") return generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration, { schema: options });
      if (route === "recreation") {
        const plugin = await remoteMcpArtifactPlugin((await generateRemoteMcpArtifact(configuration)).artifact, { binding: { env: {} }, commands: options });
        const shell = new Shell({ fs: createMemoryFileSystem() });
        try { shell.use(plugin); const result = await shell.exec("catalog echo"); if (result.exitCode !== 0) throw new Error(result.stderr); return result; }
        finally { await shell.dispose(); }
      }
      const management = createRemoteMcpManagementCommand([server], route === "management-generation" ? { generation: { schema: options } }
        : route === "management-resource" ? { resources: options } : { authentication: options });
      return execute(management, route === "management-generation" ? "mcp generate" : route === "management-resource" ? "mcp resource catalog memo://005930" : "mcp auth catalog --json");
    };
    try {
      if (expected === undefined) { await run(); expect(fetch).toHaveBeenCalled(); expect(ambient).not.toHaveBeenCalled(); }
      else await expect(run()).rejects.toThrow(expected);
      if (field !== "fetch" && field !== "maxResponseBytes") expect(fetch).not.toHaveBeenCalled();
    } finally { ambient.mockRestore(); }
  }
);

it.each(["schema", "command", "resource"] as const)("retains a hidden discovery-cache handle through %s", async route => {
  const issuer = "https://auth.example", set = vi.fn(), cache = { get: async () => null, set };
  let authorized = false;
  const provider = { authorizeRequest: ({ headers }: { headers: Headers }) => { if (authorized) headers.set("Authorization", "Bearer granted"); },
    handleUnauthorized: () => { authorized = true; return { action: "retry" as const }; } };
  const fetch = vi.fn(async (target: string | URL, init?: RequestInit) => {
    if (String(target) === `${url}/metadata`) return Response.json({ resource: url, authorization_servers: [issuer] });
    if (String(target) !== url) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
    if (new Headers(init?.headers).get("Authorization") !== "Bearer granted") return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${url}/metadata"` } });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" }
    } : rpc.method === "tools/list" ? { tools } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "complete" }] } : { contents: [{ uri: "memo://005930", text: "complete" }] } });
  });
  const options = { fetch, oauthDiscoveryCache: cache }; Object.defineProperty(options, "oauthDiscoveryCache", { enumerable: false });
  const entry = { ...server, tools, oauth: { provider } };
  if (route === "schema") await fetchRemoteMcpSchema({ ...entry, tools: undefined }, options);
  else if (route === "resource") await accessRemoteMcpResources(entry, { operation: "read", uri: "memo://005930" }, options);
  else {
    const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(await createRemoteMcpCommands([entry], options)) });
    try { expect((await shell.exec("catalog echo")).exitCode).toBe(0); } finally { await shell.dispose(); }
  }
  expect(set).toHaveBeenCalledOnce(); expect(set).toHaveBeenCalledWith(url, expect.objectContaining({ resource: url, authorizationServer: issuer }));
});
