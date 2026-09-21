import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { DefaultOAuthClientProviderOptions, StoredOAuthSession } from "mcp-oauth";
import { accessRemoteMcpResources, createRemoteMcpCommands, fetchRemoteMcpSchema } from "./index.js";

const selected = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock("../../mcp-oauth/src/client/loopback-authorization.js", async importOriginal => ({ ...await importOriginal<typeof import("../../mcp-oauth/src/client/loopback-authorization.js")>(),
  createLoopbackAuthorizationSession: async (options: Record<string, unknown>) => {
    selected.options = options;
    (options.signal as AbortSignal | undefined)?.throwIfAborted();
    return { redirectUri: options.redirectUri ?? "http://127.0.0.1:49152/callback", waitForCode: async () => "005930", close() {} };
  } }));

const fields = ["signal", "timeoutMs", "redirectUri", "createServer", "openBrowser", "readLine"] as const;
it.each((["schema", "command", "resource"] as const).flatMap(route => fields.map(field => ({ route, field }))))(
  "preserves nonenumerable browser $field through $route", async ({ route, field }) => {
    const controller = new AbortController(), canceled = new Error("original browser signal canceled");
    const original = field === "signal" ? controller.signal : field === "timeoutMs" ? 17
      : field === "redirectUri" ? "http://127.0.0.1:39119/original?app=one" : vi.fn();
    const browser = Object.defineProperty({}, field, { value: original, configurable: true }) as DefaultOAuthClientProviderOptions["browser"];
    const resource = "https://resource.example/mcp", issuer = "https://auth.example";
    const tool = { name: "echo", inputSchema: { type: "object" } };
    let session: StoredOAuthSession | null = null;
    const save = vi.fn(async (_key: string, value: StoredOAuthSession) => { session = value; });
    const oauth: DefaultOAuthClientProviderOptions = { client: { mode: "static", clientId: "original" }, browser,
      sessionStore: { load: async () => session, save, clear: async () => { session = null; } } };
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === `${resource}/metadata`) return Response.json({ resource, authorization_servers: [issuer] });
      if (target === `${issuer}/token`) return Response.json({ access_token: "original", token_type: "Bearer" });
      if (target !== resource) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
      if (new Headers(init?.headers).get("Authorization") !== "Bearer original") return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource}/metadata"` } });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [tool] } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "005930" }] } : { contents: [{ uri: "memo://005930", text: "complete" }] } });
    });
    const server = { name: "catalog", url: resource, protocolVersion: "2025-03-26" as const, oauth };
    selected.options = undefined;
    if (route === "command") {
      const commands = await createRemoteMcpCommands([{ ...server, tools: [tool] }], { fetch });
      expect(fetch).not.toHaveBeenCalled();
      Object.defineProperty(browser, field, { value: undefined });
      if (field === "signal") controller.abort(canceled);
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
      try { expect((await shell.exec("catalog echo")).exitCode).toBe(field === "signal" ? 1 : 0); }
      finally { await shell.dispose(); }
    } else {
      if (field === "signal") controller.abort(canceled);
      const operation = route === "schema" ? fetchRemoteMcpSchema(server, { fetch }) : accessRemoteMcpResources(server, { operation: "read", uri: "memo://005930" }, { fetch });
      if (field === "signal") await expect(operation).rejects.toBe(canceled); else await operation;
    }
    if (field === "signal") { expect((selected.options?.signal as AbortSignal).reason).toBe(canceled); expect(save).not.toHaveBeenCalled(); }
    else expect(selected.options?.[field]).toBe(original);
  }
);
