import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as httpTransport from "tiny-http-mcp-server/server";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand, UserError, type Group } from "./index.js";
import { createHTTPMCPServer, runHTTPMCP, type RunHTTPMCPOptions } from "./http.js";
import { createInMemoryHostedOAuthStorage, hostedOAuth } from "./http-hosted-oauth.js";
import { createMCPServer, MCP_STREAM_METHODS } from "./mcp.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const producer = vi.fn(async function* () { yield 42; });
const watch = defineStreamCommand({
  name: "watch", scope: ["mcp"], params: S.Object({}), event: S.Number(), handler: producer
});
const check = defineCommand({ name: "check", scope: ["mcp"], params: S.Object({}), handler: () => "ready" });
const root = defineGroup({ name: "audit", children: [watch, check] });
const options = { name: "audit", version: "1", errorReports: false as const };
const unsupportedMessage = "MCP streams require a transport with session-scoped notifications.";

describe.each(["create", "run"] as const)("%s rejects unsupported stream transports", (entrypoint) => {
  const create = entrypoint === "create" ? createHTTPMCPServer : runHTTPMCP;

  it.each([
    { label: "single root", roots: root, controls: {}, names: ["audit__watch"] },
    {
      label: "nested root",
      roots: defineGroup({ name: "audit", children: [defineGroup({ name: "nested", children: [watch] })] }),
      controls: {},
      names: ["audit__nested__watch"]
    },
    {
      label: "multiple roots",
      roots: [root, defineGroup({ name: "other", children: [watch] })],
      controls: {},
      names: ["audit__watch", "other__watch"]
    },
    {
      label: "unprefixed stream", roots: root,
      controls: { omitRootToolNamePrefix: true }, names: ["watch"]
    },
    {
      label: "allowlisted group", roots: root,
      controls: { tools: ["audit"] }, names: ["audit__watch"]
    }
  ])("rejects $label before transport creation for either POST response format", async ({ roots, controls, names }) => {
    const factory = vi.spyOn(httpTransport, "createHttpServer").mockImplementation(() => {
      throw new Error("HTTP transport must not be created");
    });
    for (const enableJsonResponse of [true, false]) {
      const failure = await create(roots, { ...options, ...controls, sessionIdGenerator: undefined, enableJsonResponse })
        .then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(UserError);
      expect((failure as Error).message).toContain(unsupportedMessage);
      for (const name of names) expect((failure as Error).message).toContain(name);
      expect((failure as Error).message).toContain("stateful HTTP or stdio");
      expect((failure as Error).message).toContain("tools option");
    }
    expect(factory).not.toHaveBeenCalled();
    expect(producer).not.toHaveBeenCalled();
  });

  it.each([
    { label: "stateless", sessionIdGenerator: undefined },
    { label: "stateful", sessionIdGenerator: randomUUID }
  ])("respects hosted OAuth's stateless override with $label options", async ({ sessionIdGenerator }) => {
    const factory = vi.spyOn(httpTransport, "createHttpServer").mockImplementation(() => {
      throw new Error("HTTP transport must not be created");
    });
    const oauth = hostedOAuth({
      publicUrl: "https://audit.example/mcp",
      storage: createInMemoryHostedOAuthStorage({ development: true }),
      provider: { name: "Audit", login: { fields: ["token"] }, connect: vi.fn(), services: vi.fn() }
    });
    await expect(create(root, { ...options, oauth, sessionIdGenerator })).rejects.toThrow(unsupportedMessage);
    expect(factory).not.toHaveBeenCalled();
    expect(producer).not.toHaveBeenCalled();
  });
});

it.each([
  { label: "default stateful", controls: {}, roots: root, streams: ["audit__watch"] },
  { label: "custom stateful", controls: { sessionIdGenerator: randomUUID }, roots: root, streams: ["audit__watch"] },
  { label: "empty allowlist", controls: { sessionIdGenerator: undefined, tools: [] }, roots: root, streams: [] },
  {
    label: "allowlisted ordinary command", controls: { sessionIdGenerator: undefined, tools: ["audit__check"] },
    roots: root, streams: []
  },
  {
    label: "allowlisted prefixed stream", controls: { tools: ["audit__watch"] },
    roots: root, streams: ["audit__watch"]
  },
  {
    label: "unprefixed ordinary command",
    controls: { sessionIdGenerator: undefined, omitRootToolNamePrefix: true, tools: ["check"] },
    roots: root, streams: []
  },
  {
    label: "SDK-only stream", controls: { sessionIdGenerator: undefined },
    roots: defineGroup({
      name: "audit", children: [check, defineStreamCommand({
        name: "watch", scope: ["sdk"], params: S.Object({}), event: S.Number(), handler: producer
      })]
    }), streams: []
  },
  {
    label: "ordinary stateless", controls: { sessionIdGenerator: undefined },
    roots: defineGroup({ name: "audit", children: [check] }), streams: []
  }
] satisfies Array<{ label: string; controls: Partial<RunHTTPMCPOptions>; roots: Group; streams: string[] }>)
  ("preserves $label composition", async ({ controls, roots, streams }) => {
    const server = await createHTTPMCPServer(roots, { ...options, ...controls });
    const handle = await server.listenHttp({ port: 0 });
    cleanups.push(handle.close);
    await server.handleMessage("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "audit", version: "1" }
    });
    await server.handleMessage("notifications/initialized", {});
    const listed = await server.handleMessage(MCP_STREAM_METHODS.list, {});
    expect(listed.error).toBeUndefined();
    expect((listed.result as { streams: Array<{ name: string }> }).streams.map((stream) => stream.name)).toEqual(streams);
  });

it("preserves stdio stream exposure", async () => {
  const server = createMCPServer(root, options);
  await server.handleMessage("initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "audit", version: "1" }
  });
  await server.handleMessage("notifications/initialized", {});
  const listed = await server.handleMessage(MCP_STREAM_METHODS.list, {});
  expect(listed).toMatchObject({ result: { streams: [{ name: "audit__watch" }] } });
  expect(producer).not.toHaveBeenCalled();
});
