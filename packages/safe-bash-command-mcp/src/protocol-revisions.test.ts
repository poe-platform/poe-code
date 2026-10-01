import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpCommands, fetchRemoteMcpSchema, generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

it.each(["2025-06-18", "2025-11-25"] as const)("uses legacy %s across discovery, direct commands and artifacts", async protocolVersion => {
  const tool = { name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } };
  const server = { name: "legacy", url: "https://legacy.example/mcp", protocolVersion };
  const methods: string[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "DELETE") {
      expect(headers.get("MCP-Protocol-Version")).toBe(protocolVersion);
      return new Response(null, { status: 204 });
    }
    if (init?.method === "GET") {
      expect(headers.get("MCP-Protocol-Version")).toBe(protocolVersion);
      return new Response(null, { status: 405 });
    }
    const request = JSON.parse(String(init?.body)); methods.push(request.method);
    if (request.method !== "initialize") expect(headers.get("MCP-Protocol-Version")).toBe(protocolVersion);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "legacy", version: "1" } }
      : request.method === "tools/list" ? { tools: [tool] }
        : { content: [], structuredContent: request.params.arguments };
    if (request.method === "initialize") expect(request.params.protocolVersion).toBe(protocolVersion);
    return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "Mcp-Session-Id": "legacy-session" } });
  });
  expect((await fetchRemoteMcpSchema(server, { fetch })).tools).toEqual([tool]);
  const supplied = { ...server, tools: [tool] };
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([supplied]).configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(generated.module).toString("base64")}`);
  const direct = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(await createRemoteMcpCommands([supplied], { fetch })) });
  const recreated = new Shell({ fs: createMemoryFileSystem() });
  try {
    await recreated.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: {} }, commands: { fetch } }));
    for (const shell of [direct, recreated]) {
      const result = await shell.exec("legacy echo --value=005930");
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).structuredContent).toEqual({ value: "005930" });
    }
    expect(methods).toEqual([
      "initialize", "notifications/initialized", "tools/list",
      "initialize", "notifications/initialized", "tools/call",
      "initialize", "notifications/initialized", "tools/call"
    ]);
  } finally { await direct.dispose(); await recreated.dispose(); }
});
