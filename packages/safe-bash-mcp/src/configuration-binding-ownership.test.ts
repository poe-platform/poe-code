import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { initRemoteMcpConfiguration, bindRemoteMcpConfiguration, authenticateRemoteMcpServer, generateRemoteMcpArtifact,
  remoteMcpArtifactPlugin, createRemoteMcpManagementCommand, type ConfigurationBindingOptions } from "./index.js";
const url = "https://resource.example/mcp";
const tools = ["first", "second"].map(name => ({ name, inputSchema: { type: "object" } }));
const entry = { name: "catalog", url, tools, protocolVersion: "2025-03-26" as const, auth: { type: "bearer" as const, env: "TOKEN" } };
const configuration = initRemoteMcpConfiguration([entry]).configuration;
it.each((["binding", "auth", "artifact", "management"] as const).flatMap(route =>
  (["env", "maxCredentialBytes", "maxConfigurationBytes", "maxTools"] as const).map(field => ({ route, field }))))(
  "retains hidden binding $field through $route", async ({ route, field }) => {
    const binding: ConfigurationBindingOptions = { env: { TOKEN: "original-grant" }, maxCredentialBytes: field === "maxCredentialBytes" ? 1 : 1000,
      maxConfigurationBytes: field === "maxConfigurationBytes" ? 1 : 100_000, maxTools: field === "maxTools" ? 1 : 1000 };
    Object.defineProperty(binding, field, { enumerable: false });
    const expected = field === "env" ? undefined : field === "maxCredentialBytes" ? "credential environment byte limit"
      : field === "maxConfigurationBytes" ? "configuration byte limit" : "tool limit";
    const fetch = vi.fn(async (_target: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer original-grant");
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "synthetic", version: "1" } } });
    });
    if (route === "management") {
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([createRemoteMcpManagementCommand([entry], { authentication: { binding, fetch } })]) });
      try { const result = await shell.exec("mcp auth catalog --json"); expect(result.exitCode).toBe(expected === undefined ? 0 : 1);
        if (expected !== undefined) { expect(result.stderr).toContain(expected); expect(result.stdout).toBe(""); } }
      finally { await shell.dispose(); }
    } else {
      const run = async () => {
        if (route === "auth") return authenticateRemoteMcpServer(configuration.servers[0], { binding, fetch });
        if (route === "artifact") return remoteMcpArtifactPlugin((await generateRemoteMcpArtifact(configuration)).artifact, { binding });
        const [bound] = bindRemoteMcpConfiguration(configuration, binding); expect(new Headers(bound.headers).get("Authorization")).toBe("Bearer original-grant");
      };
      if (expected === undefined) await run(); else await expect(run()).rejects.toThrow(expected);
    }
    if (expected !== undefined || route === "binding" || route === "artifact") expect(fetch).not.toHaveBeenCalled();
    else expect(fetch).toHaveBeenCalled();
  }
);
