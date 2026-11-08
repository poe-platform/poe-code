import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { DefaultOAuthClientProviderOptions, StoredOAuthSession } from "mcp-oauth";
import { accessRemoteMcpResources, createRemoteMcpCommands, fetchRemoteMcpSchema } from "./index.js";

vi.mock("../../mcp-oauth/src/client/loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("../../mcp-oauth/src/client/loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async () => ({ redirectUri: "http://127.0.0.1:49152/callback", waitForCode: async () => "005930", close() {} }) }));

const fields = ["mode", "clientId", "clientSecret", "tokenEndpointAuthMethod", "scope", "clientName", "softwareId", "softwareVersion"] as const;
it.each((["schema", "command", "resource"] as const).flatMap(route => fields.map(field => ({ route, field }))))(
  "retains nonenumerable native client $field through $route", async ({ route, field }) => {
    const resource = "https://resource.example/mcp", issuer = "https://auth.example", tool = { name: "echo", inputSchema: { type: "object" } };
    const dynamic = field === "clientName" || field === "softwareId" || field === "softwareVersion";
    const metadata = { clientName: "Original app", softwareId: "original-software", softwareVersion: "original-version", scope: "read" };
    const client: DefaultOAuthClientProviderOptions["client"] = dynamic ? { mode: "dynamic", tokenEndpointAuthMethod: "none", metadata }
      : { mode: "static", clientId: "original", clientSecret: "original-secret",
        tokenEndpointAuthMethod: field === "clientSecret" ? "client_secret_post" : "none", metadata };
    const owner = field === "scope" || field === "clientName" || field === "softwareId" || field === "softwareVersion" ? metadata : client;
    Object.defineProperty(owner, field, { enumerable: false });
    let stored: StoredOAuthSession | null = null;
    const registrations: Record<string, unknown>[] = [], redemptions: URLSearchParams[] = [];
    const oauth: DefaultOAuthClientProviderOptions = { client, browser: {}, sessionStore: { load: async () => stored,
      save: async (_key, value) => { stored = value; }, clear: async () => { stored = null; } } };
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === `${resource}/metadata`) return Response.json({ resource, authorization_servers: [issuer] });
      if (target === `${issuer}/register`) { registrations.push(JSON.parse(String(init?.body))); return Response.json({ client_id: "registered", token_endpoint_auth_method: "none" }); }
      if (target === `${issuer}/token`) { redemptions.push(new URLSearchParams(String(init?.body))); return Response.json({ access_token: "original-access", token_type: "Bearer", scope: field === "scope" ? "read write" : "read" }); }
      if (target !== resource) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"], response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
      if (new Headers(init?.headers).get("Authorization") !== "Bearer original-access") return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource}/metadata"` } });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [tool] } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "005930" }] } : { contents: [{ uri: "memo://005930", text: "complete" }] } });
    });
    const server = { name: "catalog", url: resource, protocolVersion: "2025-03-26" as const, oauth };
    if (route === "command") {
      const commands = await createRemoteMcpCommands([{ ...server, tools: [tool] }], { fetch }); expect(fetch).not.toHaveBeenCalled();
      Object.defineProperty(owner, field, { value: field === "scope" ? "read write" : undefined });
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
      try { const result = await shell.exec("catalog echo"); expect(result.exitCode).toBe(field === "scope" ? 1 : 0);
        if (field === "scope") { expect(result.stdout).toBe(""); expect(result.stderr).toContain("scope"); } }
      finally { await shell.dispose(); }
    } else {
      const operation = route === "schema" ? fetchRemoteMcpSchema(server, { fetch }) : accessRemoteMcpResources(server, { operation: "read", uri: "memo://005930" }, { fetch });
      if (field === "scope") await expect(operation).rejects.toThrow("requested OAuth scope"); else await operation;
    }
    expect(registrations).toHaveLength(dynamic ? 1 : 0); expect(redemptions).toHaveLength(1);
    if (dynamic) expect(registrations[0]).toMatchObject({ client_name: "Original app", software_id: "original-software", software_version: "original-version", scope: "read" });
    expect(redemptions[0].get("client_id")).toBe(dynamic ? "registered" : "original");
    expect(redemptions[0].get("client_secret")).toBe(field === "clientSecret" ? "original-secret" : null);
    if (field === "scope") expect(stored?.tokens).toBeUndefined(); else expect(stored?.tokens?.accessToken).toBe("original-access");
  }
);
