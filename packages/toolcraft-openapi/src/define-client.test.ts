import { afterEach, describe, expect, it } from "vitest";
import { defineCommand, defineGroup, S, UserError, type AuthProvider, type CommandNode } from "toolcraft";
import { createMCPServer } from "toolcraft/mcp";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { defineClient } from "./index.js";

function createAuthProvider(commands: CommandNode<any>[]): AuthProvider {
  return {
    getToken: async () => "token",
    commands,
  };
}

function createCommand(name: string, scope?: Array<"cli" | "mcp" | "sdk">) {
  return defineCommand({
    name,
    ...(scope === undefined ? {} : { scope }),
    params: S.Object({}),
    handler: async () => name,
  });
}

async function createClientPair(server: ReturnType<typeof createMCPServer>) {
  return createSdkTestPair(
    server,
    () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
  );
}

describe("defineClient", () => {
  afterEach(() => {
    delete process.env.CLIENT_TOKEN;
  });

  it("merges generated and handwritten commands under shared groups", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
      handwrittenCommands: [defineGroup({ name: "bots", children: [createCommand("view")] })],
    });

    const botsGroup = client.root.children.find((child) => child.name === "bots");

    expect(botsGroup).toMatchObject({
      kind: "group",
      children: [{ name: "list" }, { name: "view" }],
    });
  });

  it("throws when generated and handwritten commands share the same command path", () => {
    expect(() =>
      defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
        handwrittenCommands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
      })
    ).toThrowError(
      new UserError(
        'Command path "bots list" is defined more than once (generated and handwritten).'
      )
    );
  });

  it("throws when a group and command share the same path", () => {
    expect(() =>
      defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
        handwrittenCommands: [createCommand("bots")],
      })
    ).toThrowError(
      new UserError('Command path "bots" is defined more than once (generated and handwritten).')
    );
  });

  it("forces contributed auth groups into CLI scope", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([
        defineGroup({
          name: "auth",
          scope: ["mcp"],
          children: [createCommand("login", ["mcp"])],
        }),
      ]),
      commands: [],
    });

    expect(client.root.children[0]).toMatchObject({
      name: "auth",
      scope: ["cli"],
      children: [{ name: "login", scope: ["cli"] }],
    });
  });

  it("keeps auth commands out of the MCP tool list", async () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([
        defineGroup({
          name: "auth",
          scope: ["mcp"],
          children: [createCommand("login", ["mcp"])],
        }),
      ]),
      commands: [defineGroup({ name: "bots", scope: ["mcp"], children: [createCommand("list", ["mcp"])] })],
    });

    const server = createMCPServer(client.root, {
      name: client.name,
      version: "1.0.0",
      omitRootToolNamePrefix: true,
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      const result = await mcpClient.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(["bots__list"]);
    } finally {
      await cleanup();
    }
  });

  it("round-trips a generated MCP command through tiny-mcp-client", async () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([
        defineGroup({
          name: "auth",
          children: [createCommand("login")],
        }),
      ]),
      commands: [
        defineGroup({
          name: "bots",
          scope: ["mcp"],
          children: [
            defineCommand({
              name: "view",
              scope: ["mcp"],
              params: S.Object({
                botHandle: S.String(),
                limit: S.Optional(
                  S.Number({
                    jsonType: "integer",
                  })
                ),
              }),
              handler: async ({ params }) => ({
                botHandle: params.botHandle,
                limit: params.limit ?? null,
              }),
            }),
          ],
        }),
      ],
    });

    const server = createMCPServer(client.root, {
      name: client.name,
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      services: client.services,
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      const tools = await mcpClient.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === "bots__view");

      expect(tool).toMatchObject({
        inputSchema: {
          type: "object",
          properties: {
            bot_handle: {
              type: "string",
            },
            limit: {
              type: "integer",
            },
          },
          required: ["bot_handle"],
        },
      });

      const result = await mcpClient.callTool({
        name: "bots__view",
        arguments: {
          bot_handle: "my-bot",
          limit: 2,
        },
      });

      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: '{"botHandle":"my-bot","limit":2}',
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("derives the MCP prefix from the client name", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands: [],
    });

    expect(client.mcpPrefix).toBe("internal_agent");
  });

  it("throws when the client name contains uppercase characters", () => {
    expect(() =>
      defineClient({
        name: "Internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands: [],
      })
    ).toThrowError(new UserError('Client name "Internal-agent" must use lowercase letters, numbers, and hyphens only.'));
  });

  it("throws when the client name contains underscores", () => {
    expect(() =>
      defineClient({
        name: "internal_agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands: [],
      })
    ).toThrowError(new UserError('Client name "internal_agent" must use lowercase letters, numbers, and hyphens only.'));
  });

  it("throws when auth is missing", () => {
    expect(() =>
      defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: undefined as never,
        commands: [],
      })
    ).toThrowError(new UserError("defineClient requires an auth provider."));
  });

  it("supports clients with no generated commands", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([createCommand("login")]),
      commands: [],
    });

    expect(client.root.children.map((child) => child.name)).toEqual(["login"]);
  });

  it("returns a root group that preserves merged children when nested under another toolcraft group", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
      handwrittenCommands: [defineGroup({ name: "bots", children: [createCommand("view")] })],
    });

    const wrapper = defineGroup({
      name: "wrapper",
      children: [client.root],
    });

    expect(wrapper.children[0]).toMatchObject({
      kind: "group",
      name: "internal-agent",
      children: [
        {
          kind: "group",
          name: "bots",
          children: [{ name: "list" }, { name: "view" }],
        },
      ],
    });

    const nestedClient = wrapper.children[0];

    expect(nestedClient?.kind).toBe("group");

    const nestedBotsGroup =
      nestedClient?.kind === "group"
        ? nestedClient.children.find((child) => child.name === "bots")
        : undefined;

    expect(nestedBotsGroup).toMatchObject({
      kind: "group",
      name: "bots",
      children: [{ name: "list" }, { name: "view" }],
    });
  });
});
