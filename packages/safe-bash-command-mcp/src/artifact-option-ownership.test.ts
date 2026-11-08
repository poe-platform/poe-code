import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand, generateRemoteMcpArtifact, initRemoteMcpConfiguration } from "./index.js";

const resource = "https://catalog.example/mcp", uri = "https://schemas.example/query";
it.each((["sdk", "management"] as const).flatMap(route => (["maxArtifactBytes", "maxConfigurationBytes", "maxTools", "binding", "schemaRegistry", "schema"] as const).map(field => ({ route, field }))))(
  "retains hidden artifact $field through $route", async ({ route, field }) => {
    const tool = { name: "echo", inputSchema: field === "schemaRegistry" ? { $ref: uri } : { type: "object" } };
    const registry = { [uri]: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
    const entry = { name: "catalog", url: resource, protocolVersion: "2025-03-26" as const,
      ...(field === "binding" || field === "schema" ? { auth: { type: "bearer" as const, env: "TOKEN" } } : { tools: [tool] }) };
    const fetch = vi.fn(async (_target: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer original-grant");
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "original", version: "1" }, instructions: "complete005930" } : { tools: [tool] } });
    });
    const options = { binding: { env: { TOKEN: "original-grant" } }, schema: { fetch }, schemaRegistry: registry,
      maxArtifactBytes: field === "maxArtifactBytes" ? 0 : 8192, maxConfigurationBytes: field === "maxConfigurationBytes" ? 0 : 8192, maxTools: field === "maxTools" ? 0 : 10 };
    Object.defineProperty(options, field, { enumerable: false });
    const run = async () => {
      if (route === "sdk") return (await generateRemoteMcpArtifact(initRemoteMcpConfiguration([entry]).configuration, options)).artifact;
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([createRemoteMcpManagementCommand([entry], { generation: options })]) });
      try { const result = await shell.exec("mcp generate"); if (result.exitCode) throw new Error(result.stderr); return JSON.parse(result.stdout); }
      finally { await shell.dispose(); }
    };
    if (field.startsWith("max")) { await expect(run()).rejects.toThrow(field); expect(fetch).not.toHaveBeenCalled(); }
    else { const result = await run(); expect(result.schemas[0].tools).toEqual([tool]); if (field === "schemaRegistry") { expect(result.schemaRegistry).toEqual(registry); expect(fetch).not.toHaveBeenCalled(); }
      else { expect(result.schemas[0].instructions).toBe("complete005930"); expect(fetch).toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("original-grant"); } }
  }
);
