import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpCommands, generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

it.each([0, false, null, ["001", 0, false, null]])("preserves modern structured JSON value %j through direct and recreated commands", async structuredContent => {
  const tool = { name: "primitive", inputSchema: { type: "object" }, outputSchema: { const: structuredContent } };
  const server = { name: "values", url: "https://values.example/mcp", protocolVersion: "2026-07-28" as const, tools: [tool] };
  const expected = { resultType: "complete", content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  const methods: string[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    expect(init?.method).toBe("POST");
    const request = JSON.parse(String(init.body)); methods.push(request.method);
    expect(["server/discover", "tools/call"]).toContain(request.method);
    const result = request.method === "server/discover"
      ? { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private" }
      : expected;
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  const artifact = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(artifact.module).toString("base64")}`);
  const direct = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(await createRemoteMcpCommands([server], { fetch })) });
  const recreated = new Shell({ fs: createMemoryFileSystem() });
  try {
    await recreated.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: {} }, commands: { fetch } }));
    expect(fetch).not.toHaveBeenCalled();
    for (const shell of [direct, recreated]) {
      const result = await shell.exec("values primitive");
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(result.stdout).toBe(`${JSON.stringify(expected)}\n`);
    }
    expect(methods).toEqual(["server/discover", "tools/call", "server/discover", "tools/call"]);
  } finally { await direct.dispose(); await recreated.dispose(); }
});
