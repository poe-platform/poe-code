import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { createRemoteMcpCommands, generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

it("preserves draft-7 dependency fields through direct and recreated native commands", async () => {
  const tool = { name: "configure", inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object", properties: { enabled: { type: "boolean" } },
    dependencies: { enabled: {
      properties: { retries: { type: "integer", minimum: 0, description: "Retry budget" } },
      required: ["retries"]
    } }
  } };
  const server = { name: "dependent", url: "https://dependent.example/mcp", protocolVersion: "2026-07-28" as const, tools: [tool] };
  const methods: string[] = [];
  const received: unknown[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (_url, init) => {
    expect(init?.method).toBe("POST");
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    expect(["server/discover", "tools/call"]).toContain(request.method);
    if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "private"
    } });
    received.push(request.params.arguments);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: {
      resultType: "complete", content: [], structuredContent: request.params.arguments
    } });
  });
  const artifact = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration);
  const module = await import(`data:text/javascript;base64,${Buffer.from(artifact.module).toString("base64")}`);
  const direct = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(await createRemoteMcpCommands([server], { fetch })) });
  const recreated = new Shell({ fs: createMemoryFileSystem() });
  try {
    await recreated.use(await remoteMcpArtifactPlugin(module.default, { binding: { env: {} }, commands: { fetch } }));
    for (const shell of [direct, recreated]) {
      const before = fetch.mock.calls.length;
      const help = await shell.exec("dependent configure --help");
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain("--retries");
      expect(help.stdout).toContain("Retry budget");
      const schema = await shell.exec("dependent configure --schema");
      expect(JSON.parse(schema.stdout)).toEqual(tool);
      expect((await shell.exec("dependent configure --enabled")).exitCode).toBe(2);
      expect((await shell.exec("dependent configure --enabled --retries=-1")).exitCode).toBe(2);
      expect(fetch.mock.calls.length).toBe(before);
      for (const source of [
        "dependent configure --enabled --retries=0",
        "dependent configure --raw '{\"enabled\":true,\"retries\":0}'"
      ]) {
        const result = await shell.exec(source);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).structuredContent).toEqual({ enabled: true, retries: 0 });
      }
    }
    expect(received).toEqual(Array.from({ length: 4 }, () => ({ enabled: true, retries: 0 })));
    expect(methods).toEqual(Array.from({ length: 4 }, () => ["server/discover", "tools/call"]).flat());
  } finally { await direct.dispose(); await recreated.dispose(); }
});
