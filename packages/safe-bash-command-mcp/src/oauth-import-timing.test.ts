import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { DefaultOAuthClientProviderOptions } from "mcp-oauth";
import { fetchRemoteMcpSchema, createRemoteMcpCommands, accessRemoteMcpResources } from "./index.js";

const url = "https://resource.example/mcp";
const tool = { name: "echo", inputSchema: { type: "object" } };

it.each((["schema", "command", "resource"] as const).flatMap(route =>
  (["expiresAt", "expiresIn", "issuedAt"] as const).map(field => ({ route, field }))))(
  "preserves native own nonenumerable $field timing through $route snapshots", async ({ route, field }) => {
    const tokens: NonNullable<DefaultOAuthClientProviderOptions["initialGrant"]>["tokens"] = {
      accessToken: "private-expired-access", tokenType: "Bearer", expiresIn: 1,
      ...(field === "expiresAt" ? { expiresAt: 0 } : {}), ...(field === "issuedAt" ? { issuedAt: 0 } : {})
    };
    Object.defineProperty(tokens, field, { enumerable: false });
    let reads = 0;
    const now = vi.fn(() => field === "expiresIn" && reads++ === 0 ? 1000 : 2000);
    const oauth: DefaultOAuthClientProviderOptions = { client: { mode: "static", clientId: "original" }, browser: {}, now,
      initialGrant: { resource: url, tokens }, sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } };
    const authorization: (string | null)[] = [];
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      authorization.push(new Headers(init?.headers).get("Authorization"));
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body));
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "synthetic", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [tool] } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "complete" }] }
        : { contents: [{ uri: "data:example/005930", text: "complete" }] } });
    });
    const server = { name: "catalog", url, protocolVersion: "2025-03-26" as const, oauth };
    if (route === "schema") expect((await fetchRemoteMcpSchema(server, { fetch })).tools).toEqual([tool]);
    else if (route === "resource") expect(await accessRemoteMcpResources(server, { operation: "read", uri: "data:example/005930" }, { fetch }))
      .toEqual({ contents: [{ uri: "data:example/005930", text: "complete" }] });
    else {
      const commands = await createRemoteMcpCommands([{ ...server, tools: [tool] }], { fetch });
      expect(now).not.toHaveBeenCalled();
      Object.defineProperty(tokens, field, { value: 100_000 });
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
      try { const result = await shell.exec("catalog echo"); expect(result.exitCode).toBe(0); }
      finally { await shell.dispose(); }
    }
    expect(authorization.length).toBeGreaterThan(0);
    expect(authorization.every(value => value === null)).toBe(true);
  }
);


it("keeps inherited timing fields absent without invoking their accessors", async () => {
  const read = vi.fn(() => { throw new Error("inherited timing must remain absent"); });
  const prototype = Object.defineProperties({}, { expiresAt: { get: read }, expiresIn: { get: read }, issuedAt: { get: read } });
  const tokens = Object.assign(Object.create(prototype), { accessToken: "private-unknown-access", tokenType: "Bearer" }) as
    NonNullable<DefaultOAuthClientProviderOptions["initialGrant"]>["tokens"];
  const now = vi.fn(() => NaN);
  const provider: DefaultOAuthClientProviderOptions = { client: { mode: "static", clientId: "original" }, browser: {}, now,
    initialGrant: { resource: url, tokens }, sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } };
  const authorization: (string | null)[] = [];
  const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    authorization.push(new Headers(init?.headers).get("Authorization"));
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const rpc = JSON.parse(String(init?.body));
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } } : { tools: [tool] } });
  });
  expect((await fetchRemoteMcpSchema({ name: "catalog", url, protocolVersion: "2025-03-26", oauth: provider }, { fetch })).tools).toEqual([tool]);
  expect(authorization.every(value => value === "Bearer private-unknown-access")).toBe(true);
  expect(now).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});
