import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";
import { z } from "zod";
import { HttpTransport, McpClient, createSdkTestPair } from "tiny-mcp-client";
import { nodeFetch } from "tiny-http-mcp-server/test-support";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createMCPServer, MCP_STREAM_METHODS } from "./mcp.js";
import {
  createHTTPMCPServer,
  runHTTPMCP,
  type ToolcraftHTTPContext
} from "./http.js";

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupCallbacks.splice(0).map((cleanup) => cleanup()));
});

function createCommands() {
  return defineGroup({
    name: "daybook",
    children: [
      defineCommand({
        name: "read-entry",
        description: "Read an entry",
        scope: ["mcp"],
        params: S.Object({ entryId: S.String() }),
        result: S.Object({ entryId: S.String(), title: S.String() }),
        handler: async ({ params }) => ({ entryId: params.entryId, title: "Breakfast" })
      }),
      defineCommand({
        name: "secret-entry",
        description: "Read a secret-backed entry",
        scope: ["mcp"],
        secrets: { token: { env: "DAYBOOK_TOKEN" } },
        params: S.Object({}),
        handler: async ({ secrets }) => secrets.token
      }),
      defineCommand({
        name: "write-entry",
        description: "Write a confirmed entry",
        scope: ["mcp"],
        confirm: true,
        params: S.Object({ title: S.String() }),
        handler: async ({ params }) => ({ written: params.title })
      }),
      defineCommand({
        name: "fail-entry",
        description: "Fail reading an entry",
        scope: ["mcp"],
        params: S.Object({}),
        handler: async () => {
          throw new Error("entry unavailable");
        }
      })
    ]
  });
}

async function captureCall(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    return {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

describe("Toolcraft HTTP MCP adapter", () => {
  it("advertises the same tools and schemas as stdio and preserves normalized results", async () => {
    const commands = createCommands();
    const options = {
      name: "daybook-test",
      version: "1.0.0",
      env: { DAYBOOK_TOKEN: "secret-value" }
    };
    const stdioPair = await createSdkTestPair(createMCPServer(commands, options), () =>
      new McpClient({ clientInfo: { name: "stdio-test", version: "1.0.0" } })
    );
    cleanupCallbacks.push(stdioPair.cleanup);

    const handle = await runHTTPMCP(commands, { ...options, port: 0 });
    cleanupCallbacks.push(handle.close);
    const httpClient = new McpClient({
      clientInfo: { name: "http-test", version: "1.0.0" }
    });
    const httpTransport = new HttpTransport({ url: handle.url, fetch: nodeFetch });
    await httpClient.connect(httpTransport);
    cleanupCallbacks.push(() => httpClient.close());

    const [stdioTools, httpTools] = await Promise.all([
      stdioPair.client.listTools(),
      httpClient.listTools()
    ]);
    expect(httpTools.tools).toEqual(stdioTools.tools);

    for (const call of [
      { name: "daybook__read_entry", arguments: { entry_id: "entry-1" } },
      { name: "daybook__secret_entry", arguments: {} },
      { name: "daybook__write_entry", arguments: { title: "Lunch" } },
      { name: "daybook__fail_entry", arguments: {} }
    ]) {
      const [stdioResult, httpResult] = await Promise.all([
        captureCall(() => stdioPair.client.callTool(call)),
        captureCall(() => httpClient.callTool(call))
      ]);
      expect(httpResult).toEqual(stdioResult);
    }
  });

  it.each([["stateful"], ["stateless"]])("supports %s mode with the official MCP SDK", async (mode) => {
    const server = await createHTTPMCPServer(createCommands(), {
      name: "daybook-sdk-test",
      version: "1.0.0",
      ...(mode === "stateless" ? { sessionIdGenerator: undefined } : {})
    });
    const handle = await server.listenHttp({ port: 0 });
    cleanupCallbacks.push(handle.close);

    const client = new Client({ name: "official-sdk-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url), { fetch: nodeFetch });
    await client.connect(transport);
    cleanupCallbacks.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "daybook__read_entry",
      "daybook__secret_entry",
      "daybook__write_entry",
      "daybook__fail_entry"
    ]);
  });

  it.each([["stateful"], ["stateless"]])("supports %s mode with tiny-mcp-client", async (mode) => {
    const handle = await runHTTPMCP(createCommands(), {
      name: "daybook-tiny-client-test",
      version: "1.0.0",
      ...(mode === "stateless" ? { sessionIdGenerator: undefined } : {})
    });
    cleanupCallbacks.push(handle.close);
    const client = new McpClient({ name: "tiny-client-test", version: "1.0.0" });
    await client.connect(new HttpTransport({ url: handle.url, fetch: nodeFetch }));
    cleanupCallbacks.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "daybook__read_entry",
      "daybook__secret_entry",
      "daybook__write_entry",
      "daybook__fail_entry"
    ]);
  });

  it("maps request-scoped authentication into command services", async () => {
    type Services = { requester: string };
    const commands = defineGroup<Services>({
      name: "auth",
      children: [
        defineCommand<Services>({
          name: "whoami",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async ({ requester }) => requester
        })
      ]
    });
    const contexts: ToolcraftHTTPContext[] = [];
    const handle = await runHTTPMCP(commands, {
      name: "auth-test",
      version: "1.0.0",
      port: 0,
      oauth: {
        resource: "http://127.0.0.1/mcp",
        authorizationServers: ["https://auth.example.com"],
        verifier: {
          async verify() {
            return {
              token: "token",
              issuer: "https://auth.example.com",
              audience: ["http://127.0.0.1/mcp"],
              scopes: [],
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              claims: {},
              subject: "user-123"
            };
          }
        }
      },
      requestServices(context) {
        contexts.push(context);
        return { requester: context.auth?.subject ?? "anonymous" };
      }
    });
    cleanupCallbacks.push(handle.close);
    const client = new McpClient({ clientInfo: { name: "auth-client", version: "1.0.0" } });
    await client.connect(
      new HttpTransport({
        url: handle.url,
        headers: { authorization: "Bearer token" },
        fetch: nodeFetch
      })
    );
    cleanupCallbacks.push(() => client.close());

    await expect(client.callTool({ name: "auth__whoami", arguments: {} })).resolves.toMatchObject({
      content: [{ type: "text", text: "user-123" }]
    });
    expect(contexts[0]?.auth?.subject).toBe("user-123");
  });

  it("preserves request services for streaming commands", async () => {
    const commands = defineGroup({
      name: "events",
      children: [
        defineStreamCommand({
          name: "watch",
          scope: ["mcp"],
          params: S.Object({}),
          event: S.Object({ requester: S.String() }),
          async *handler() {
            yield { requester: "connected" };
          }
        })
      ]
    });
    const handle = await runHTTPMCP(commands, {
      name: "stream-context-test",
      version: "1.0.0",
      port: 0,
      requestServices(context) {
        return { requester: String(context.request.headers["user-agent"]) };
      }
    });
    cleanupCallbacks.push(handle.close);
    const client = new Client({ name: "stream-context-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url), { fetch: nodeFetch });
    await client.connect(transport);
    cleanupCallbacks.push(() => client.close());

    const stdioSession = createMCPServer(commands, {
      name: "stream-context-stdio-test",
      version: "1.0.0"
    }).createMessageSession();
    await stdioSession.handleMessage("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "stream-context-stdio-client", version: "1.0.0" }
    });
    await stdioSession.handleMessage("notifications/initialized");
    cleanupCallbacks.push(async () => stdioSession.close());

    const streams = await client.request(
      { method: MCP_STREAM_METHODS.list, params: {} } as never,
      z.object({ streams: z.array(z.object({ name: z.string() }).passthrough()) })
    );
    const stdioStreams = await stdioSession.handleMessage(MCP_STREAM_METHODS.list);
    expect(streams).toEqual(stdioStreams.result);
    await expect(
      client.request(
        {
          method: MCP_STREAM_METHODS.subscribe,
          params: { name: "events__watch", arguments: {} }
        } as never,
        z.object({ subscriptionId: z.string() })
      )
    ).resolves.toEqual({ subscriptionId: "stream-1" });
  });

  it("uses loopback defaults and returns an idempotent graceful-close handle", async () => {
    const handle = await runHTTPMCP(createCommands(), {
      name: "defaults-test",
      version: "1.0.0"
    });

    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);
    await expect(Promise.all([handle.close(), handle.close()])).resolves.toEqual([
      undefined,
      undefined
    ]);
  });

  it("forwards host, origin, and request-size security controls", async () => {
    const handle = await runHTTPMCP(createCommands(), {
      name: "security-test",
      version: "1.0.0",
      allowedHosts: ["allowed.test"],
      allowedOrigins: ["https://allowed.test"],
      maxRequestBytes: 64
    });
    cleanupCallbacks.push(handle.close);
    const request = {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "security-test", version: "1.0.0" }
        }
      })
    } satisfies RequestInit;

    const deniedHost = await nodeFetch(handle.url, {
      ...request,
      headers: { ...request.headers, host: "denied.test" }
    });
    expect(deniedHost.status).toBe(403);

    const deniedOrigin = await nodeFetch(handle.url, {
      ...request,
      headers: {
        ...request.headers,
        host: "allowed.test",
        origin: "https://denied.test"
      }
    });
    expect(deniedOrigin.status).toBe(403);

    const oversized = await nodeFetch(handle.url, {
      ...request,
      headers: {
        ...request.headers,
        host: "allowed.test",
        origin: "https://allowed.test"
      }
    });
    expect(oversized.status).toBe(413);
  });
});
