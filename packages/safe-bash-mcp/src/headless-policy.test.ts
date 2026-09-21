import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { bindRemoteMcpConfiguration, createRemoteMcpCommands, fetchRemoteMcpSchema,
  generateRemoteMcpArtifact, initRemoteMcpConfiguration, remoteMcpArtifactPlugin } from "./index.js";

it.each(["discovery", "command", "artifact"] as const)("preserves default headless policy through the real %s path on repeated 401s", async path => {
  const resource = "https://catalog.example/mcp", issuer = "https://auth.example";
  const metadataUrl = "https://catalog.example/.well-known/oauth-protected-resource/mcp";
  const configuration = initRemoteMcpConfiguration([{ name: "catalog", url: resource,
    tools: [{ name: "find", inputSchema: { type: "object" } }], protocolVersion: "2025-03-26",
    auth: { type: "oauth", clientMode: "static", env: { clientId: "APP_ID" } } }]).configuration;
  const openBrowser = vi.fn(), readLine = vi.fn(), save = vi.fn();
  const binding = { env: { APP_ID: "original-client" }, oauth: { browser: { openBrowser, readLine },
    sessionStore: () => ({ load: async () => null, save, clear: vi.fn() }) } };
  const requests: string[] = [];
  const fetch = vi.fn<HttpTransportFetch>(async (input, init) => {
    const url = String(input); requests.push(url);
    if (url === resource) {
      expect(init?.method).toBe("POST");
      return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"` } });
    }
    if (url === metadataUrl) return Response.json({ resource, authorization_servers: [issuer] });
    expect(url).toBe(`${issuer}/.well-known/oauth-authorization-server`);
    return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  });
  if (path === "discovery") {
    const [bound] = bindRemoteMcpConfiguration(configuration, binding);
    for (let run = 0; run < 2; run++) await expect(fetchRemoteMcpSchema({ ...bound, tools: undefined }, { fetch })).rejects.toThrow("interactive");
  } else {
    const commands = path === "command" ? new CommandRegistry(await createRemoteMcpCommands(bindRemoteMcpConfiguration(configuration, binding), { fetch })) : undefined;
    const shell = new Shell({ fs: createMemoryFileSystem(), commands });
    try {
      if (path === "artifact") shell.use(await remoteMcpArtifactPlugin((await generateRemoteMcpArtifact(configuration)).artifact, { binding, commands: { fetch } }));
      expect(fetch).not.toHaveBeenCalled();
      for (let run = 0; run < 2; run++) {
        const result = await shell.exec("catalog find");
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("interactive");
      }
    } finally { await shell.dispose(); }
  }
  expect(requests.filter(url => url === resource)).toHaveLength(2);
  expect(openBrowser).not.toHaveBeenCalled();
  expect(readLine).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
