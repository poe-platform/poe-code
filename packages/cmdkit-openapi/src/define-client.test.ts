import { afterEach, describe, expect, it } from "vitest";
import { defineCommand, defineGroup, S, UserError, type AuthProvider, type CommandNode } from "@poe-code/cmdkit";
import { createMCPServer } from "@poe-code/cmdkit/mcp";
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
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      const result = await mcpClient.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(["internal_agent__bots__list"]);
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

  it("returns a root group that can be nested under another cmdkit group", () => {
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands: [defineGroup({ name: "bots", children: [createCommand("list")] })],
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
          children: [{ name: "list" }],
        },
      ],
    });
  });
});
