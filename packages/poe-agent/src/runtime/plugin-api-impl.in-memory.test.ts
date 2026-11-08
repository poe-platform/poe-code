import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, defineSchema, type Server } from "tiny-stdio-mcp-server";
import { createInMemoryTransportPair, type McpTransport } from "tiny-mcp-client";
import type { ToolContext } from "./types.js";
import { PluginApiImpl } from "./plugin-api-impl.js";
import { createRunContext } from "./run-context.js";

type StdioTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

const transportFactoryMock = vi.hoisted(
  () => vi.fn<(options: StdioTransportOptions) => McpTransport>(),
);

vi.mock("tiny-mcp-client", async () => {
  const actual = await vi.importActual<typeof import("tiny-mcp-client")>(
    "tiny-mcp-client",
  );

  return {
    ...actual,
    StdioTransport: class {
      readonly readable;
      readonly writable;
      readonly closed;
      readonly dispose;

      constructor(options: StdioTransportOptions) {
        const transport = transportFactoryMock(options);
        this.readable = transport.readable;
        this.writable = transport.writable;
        this.closed = transport.closed;
        this.dispose = transport.dispose.bind(transport);
      }
    },
  };
});

function createToolContext(): ToolContext {
  return {
    fork: async () => ({ output: "", messages: [] }),
    spawn: async () => ({ output: "", messages: [] }),
    signal: new AbortController().signal,
  };
}

describe("PluginApiImpl (in-memory MCP transport)", () => {
  let commandToServer: Map<string, Server>;
  let serverConnections: Promise<void>[];
  let clientTransports: McpTransport[];

  beforeEach(() => {
    commandToServer = new Map<string, Server>();
    serverConnections = [];
    clientTransports = [];

    transportFactoryMock.mockReset();
    transportFactoryMock.mockImplementation((options) => {
      const server = commandToServer.get(options.command);
      if (!server) {
        throw new Error(`No in-memory MCP server registered for command "${options.command}".`);
      }

      const { clientTransport, serverTransport } = createInMemoryTransportPair();
      clientTransports.push(clientTransport);
      serverConnections.push(server.connect(serverTransport));
      return clientTransport;
    });
  });

  afterEach(async () => {
    for (const transport of clientTransports) {
      transport.dispose(new Error("plugin-api-impl in-memory test cleanup"));
    }

    await Promise.allSettled(serverConnections);
  });

  it("creates in-memory stdio transport, discovers tools, namespaces them, and closes at run end", async () => {
    const searchSchema = defineSchema({
      query: { type: "string", description: "Search query" },
    });

    const server = createServer({ name: "repo-tools", version: "1.0.0" }).tool(
      "search",
      "Search repository",
      searchSchema,
      async (args) => `found:${args.query}`,
    );

    commandToServer.set("repo-mcp", server);

    const context = createRunContext();
    const api = new PluginApiImpl(context);

    api.addMcp({
      name: "repo",
      command: "repo-mcp",
      args: ["--stdio"],
      env: { API_KEY: "secret" },
      visibility: "skill",
    });

    await api.flushSetup();

    expect(transportFactoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "repo-mcp",
        args: ["--stdio"],
        env: expect.objectContaining({ API_KEY: "secret" }),
      }),
    );

    const repoSearchToolName = ["repo", "search"].join("_");

    const tool = context.tools.get(repoSearchToolName);
    expect(tool?.name).toBe(repoSearchToolName);
    expect(tool?.visibility).toBe("skill");

    const invocation = tool?.invoke({ query: "README" }, createToolContext());
    await expect(invocation?.next()).resolves.toEqual({
      done: true,
      value: "found:README",
    });

    await context.dispose();
    await Promise.allSettled(serverConnections);
  });

  it("defaults MCP tool visibility to model when omitted", async () => {
    const searchSchema = defineSchema({
      query: { type: "string", description: "Search query" },
    });
    const server = createServer({ name: "repo-tools", version: "1.0.0" }).tool(
      "search",
      "Search repository",
      searchSchema,
      async (args) => `default:${args.query}`,
    );

    commandToServer.set("repo-default-mcp", server);

    const context = createRunContext();
    const api = new PluginApiImpl(context);

    api.addMcp({
      name: "repo-default",
      command: "repo-default-mcp",
    });
    await api.flushSetup();

    const repoDefaultSearchToolName = ["repo-default", "search"].join("_");

    const tool = context.tools.get(repoDefaultSearchToolName);
    expect(tool?.visibility).toBe("model");

    const invocation = tool?.invoke({ query: "docs" }, createToolContext());
    await expect(invocation?.next()).resolves.toEqual({
      done: true,
      value: "default:docs",
    });

    await context.dispose();
    await Promise.allSettled(serverConnections);
  });
});
