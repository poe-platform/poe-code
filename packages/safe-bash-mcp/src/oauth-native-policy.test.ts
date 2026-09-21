import { Volume, createFsFromVolume } from "memfs";
import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { DefaultOAuthClientProviderOptions, StoredOAuthSession } from "mcp-oauth";
import { accessRemoteMcpResources, createRemoteMcpCommands, fetchRemoteMcpSchema } from "./index.js";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt(password: string, salt: string, size: number, done: (error: Error | null, key: Buffer) => void) {
    queueMicrotask(() => done(null, actual.createHash("shake256", { outputLength: size }).update(password).update(salt).digest()));
  } };
});

const url = "https://resource.example/mcp", issuer = "https://auth.example";
const tool = { name: "echo", inputSchema: { type: "object" } };
const fields = ["allowInteractive", "now", "sessionStore", "sessionLockTimeoutMs", "persistenceNamespace", "resourceIdentity"] as const;

it.each((["schema", "command", "resource"] as const).flatMap(route => fields.map(field => ({ route, field }))))(
  "preserves native nonenumerable $field policy through $route", async ({ route, field }) => {
    const saved: StoredOAuthSession = { resource: url, authorizationServer: issuer, client: { clientId: "original" },
      tokens: { accessToken: "selected-store-grant", tokenType: "Bearer", expiresAt: null }, discovery: {
        resourceMetadataUrl: `${url}/metadata`, resourceMetadata: { resource: url, authorization_servers: [issuer] },
        authorizationServerMetadata: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` }
      } };
    const lockTimeouts: number[] = [], authorization: (string | null)[] = [];
    const now = vi.fn(() => 1000), createServer = vi.fn(() => { throw new Error("unexpected interactive listener"); });
    const oauth: DefaultOAuthClientProviderOptions = { client: { mode: "static", clientId: "original" }, browser: { createServer },
      allowInteractive: false, now, sessionLockTimeoutMs: 17,
      sessionStore: { load: async () => field === "sessionStore" ? saved : null, save: async () => {}, clear: async () => {},
        withLock: async (_resource, operation, options) => { lockTimeouts.push(options.timeoutMs); return operation(); } },
      authStore: { backend: "file", fileStore: { fs: createFsFromVolume(new Volume()).promises, filePath: "/synthetic/auth.enc", salt: "fixture",
        getMachineIdentity: () => ({ hostname: "synthetic", username: "synthetic" }) } },
      ...(field === "now" ? { initialGrant: { resource: url, tokens: { accessToken: "selected-clock-grant", tokenType: "Bearer", expiresAt: 2000 } } } : {}),
      ...(field === "persistenceNamespace" ? { persistenceNamespace: "" } : {}),
      ...(field === "resourceIdentity" ? { resourceIdentity: "catalog" } : {}) };
    Object.defineProperty(oauth, field, { enumerable: false });
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === `${url}/metadata`) return Response.json({ resource: url, authorization_servers: [issuer] });
      if (target !== url) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
      authorization.push(new Headers(init?.headers).get("Authorization"));
      if (field === "allowInteractive") return new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${url}/metadata"` } });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [tool] } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "complete" }] }
        : { contents: [{ uri: "memo://005930", text: "complete" }] } });
    });
    const server = { name: "catalog", url, protocolVersion: "2025-03-26" as const, oauth };
    const error = field === "allowInteractive" ? "interactive" : field === "persistenceNamespace" ? "namespace"
      : field === "resourceIdentity" ? "custom stores" : undefined;
    if (route === "command") {
      const commands = await createRemoteMcpCommands([{ ...server, tools: [tool] }], { fetch });
      expect(fetch).not.toHaveBeenCalled(); expect(now).not.toHaveBeenCalled();
      // Policy is captured offline; selected dependencies remain the original handles.
      Object.defineProperty(oauth, field, { value: field === "now" ? () => 9999 : field === "allowInteractive" ? true : undefined });
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
      try { const result = await shell.exec("catalog echo"); expect(result.exitCode).toBe(error === undefined ? 0 : 1);
        if (error !== undefined) expect(result.stderr).toContain(error); }
      finally { await shell.dispose(); }
    } else {
      const operation = route === "schema" ? fetchRemoteMcpSchema(server, { fetch })
        : accessRemoteMcpResources(server, { operation: "read", uri: "memo://005930" }, { fetch });
      if (error !== undefined) await expect(operation).rejects.toThrow(error); else await operation;
    }
    expect(createServer).not.toHaveBeenCalled();
    if (field === "now" || field === "sessionStore") {
      expect(authorization.length).toBeGreaterThan(0);
      expect(authorization.every(value => value === `Bearer selected-${field === "now" ? "clock" : "store"}-grant`)).toBe(true);
    }
    if (field === "sessionLockTimeoutMs") {
      expect(lockTimeouts.length).toBeGreaterThan(0); expect(lockTimeouts.every(value => value >= 0 && value <= 17)).toBe(true);
    }
    if (field === "persistenceNamespace" || field === "resourceIdentity") expect(fetch).not.toHaveBeenCalled();
  }
);
