import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "@poe-code/cmdkit-schema";
import {
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  McpClient,
  McpError,
  createSdkTestPair,
} from "tiny-mcp-client";
import { defineCommand, defineGroup } from "./index.js";
import { createMCPServer } from "./mcp.js";

describe("createMCPServer", () => {
  const originalPoeApiKey = process.env.POE_API_KEY;
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    process.env.POE_API_KEY = originalPoeApiKey;
    process.env.API_KEY = originalApiKey;
  });

  async function createClient(server: ReturnType<typeof createMCPServer>) {
    return createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      })
    );
  }

  it("lists only mcp-scoped commands that match the allowlist and applies schema casing", async () => {
    const usage = defineCommand({
      name: "usage",
      description: "Show usage",
      scope: ["mcp"],
      params: S.Object({
        dryRun: S.Boolean(),
        botConfig: S.Object({
          apiKey: S.String(),
        }),
      }),
      handler: async () => "usage",
    });

    const create = defineCommand({
      name: "create",
      description: "Create bot",
      params: S.Object({
        botName: S.String(),
      }),
      handler: async () => "created",
    });

    const remove = defineCommand({
      name: "remove",
      description: "Remove bot",
      scope: ["cli"],
      params: S.Object({}),
      handler: async () => "removed",
    });

    const sdkOnly = defineCommand({
      name: "sdk-only",
      description: "SDK only",
      scope: ["sdk"],
      params: S.Object({}),
      handler: async () => "sdk",
    });

    const root = defineGroup({
      name: "root",
      children: [
        usage,
        defineGroup({
          name: "bot",
          scope: ["mcp"],
          children: [create, remove],
        }),
        sdkOnly,
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
      tools: ["usage", "bot"],
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(["usage", "bot.create"]);
      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          dry_run: {
            type: "boolean",
          },
          bot_config: {
            type: "object",
            properties: {
              api_key: {
                type: "string",
              },
            },
            required: ["api_key"],
          },
        },
        required: ["dry_run", "bot_config"],
      });
      expect(result.tools[1]?.inputSchema).toEqual({
        type: "object",
        properties: {
          bot_name: {
            type: "string",
          },
        },
        required: ["bot_name"],
      });
    } finally {
      await cleanup();
    }
  });

  it("includes all descendants when a nested group is allowlisted and supports camel casing", async () => {
    const create = defineCommand({
      name: "create-bot",
      description: "Create a bot",
      params: S.Object({
        botName: S.String(),
        botConfig: S.Object({
          apiKey: S.String(),
        }),
      }),
      handler: async ({ params }) => params,
    });

    const remove = defineCommand({
      name: "remove-bot",
      description: "Remove a bot",
      params: S.Object({
        botName: S.String(),
      }),
      handler: async ({ params }) => params,
    });

    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bot-admin",
          scope: ["mcp"],
          children: [
            defineGroup({
              name: "bot",
              children: [create, remove],
            }),
          ],
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
      tools: ["bot-admin.bot"],
      casing: "camel",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual([
        "bot-admin.bot.create-bot",
        "bot-admin.bot.remove-bot",
      ]);
      expect(result.tools[0]).toMatchObject({
        description: "Create a bot Parameters: botName (required), botConfig.apiKey (required).",
        inputSchema: {
          type: "object",
          properties: {
            botName: {
              type: "string",
            },
            botConfig: {
              type: "object",
              properties: {
                apiKey: {
                  type: "string",
                },
              },
              required: ["apiKey"],
            },
          },
          required: ["botName", "botConfig"],
        },
      });
    } finally {
      await cleanup();
    }
  });

  it("composes tools from multiple root groups", async () => {
    const firstHandler = vi.fn(async ({ params }: { params: { name: string } }) => ({
      group: "first",
      name: params.name,
    }));
    const secondHandler = vi.fn(async () => ({
      group: "second",
    }));

    const firstRoot = defineGroup({
      name: "terminal-pilot",
      children: [
        defineCommand({
          name: "create-session",
          scope: ["mcp"],
          params: S.Object({
            name: S.String(),
          }),
          handler: firstHandler,
        }),
      ],
    });

    const secondRoot = defineGroup({
      name: "terminal-png",
      children: [
        defineCommand({
          name: "render",
          scope: ["mcp"],
          params: S.Object({}),
          handler: secondHandler,
        }),
      ],
    });

    const server = createMCPServer([firstRoot, secondRoot], {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual([
        "terminal-pilot.create-session",
        "terminal-png.render",
      ]);

      const callResult = await client.callTool({
        name: "terminal-pilot.create-session",
        arguments: {
          name: "demo",
        },
      });

      expect(firstHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            name: "demo",
          },
        })
      );
      expect(secondHandler).not.toHaveBeenCalled();
      expect(callResult).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              group: "first",
              name: "demo",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("maps secret resolution failures to invalid params", async () => {
    delete process.env.API_KEY;

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({
            name: S.String(),
          }),
          secrets: {
            apiKey: {
              env: "API_KEY",
            },
          },
          handler: async ({ params }) => params.name,
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "deploy",
        arguments: {},
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS,
        });
        expect((error as Error).message).toContain("Missing required secret API_KEY");
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps requirement failures to invalid params", async () => {
    delete process.env.POE_API_KEY;

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({}),
          requires: {
            auth: true,
          },
          handler: async () => "ok",
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "deploy", arguments: {} })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS,
        });
        expect((error as Error).message).toContain('requires authentication');
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps validation failures to invalid params", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({
            name: S.String(),
          }),
          handler: async ({ params }) => params.name,
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "deploy",
        arguments: {},
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS,
        });
        expect((error as Error).message).toContain('Missing required parameter "name".');
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps unknown tools to invalid params", async () => {
    const root = defineGroup({
      name: "root",
      children: [],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "missing", arguments: {} })).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS,
        });
        expect((error as Error).message).toContain("Unknown tool: missing");
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("calls the handler with resolved services and ignores confirm and progress", async () => {
    process.env.API_KEY = "secret-token";
    const progress = vi.fn();

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          description: "Deploy a bot",
          scope: ["mcp"],
          confirm: true,
          params: S.Object({
            botName: S.String(),
          }),
          secrets: {
            apiKey: {
              env: "API_KEY",
            },
          },
          handler: async (context) => {
            context.progress("deploying");
            progress("handler-called");
            return {
              botName: context.params.botName,
              apiKey: context.secrets.apiKey,
              envHasApiKey: context.env.get("API_KEY"),
              region: context.region,
            };
          },
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
      services: {
        region: "us",
      },
      casing: "camel",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({
        name: "deploy",
        arguments: {
          botName: "demo",
        },
      });

      expect(progress).toHaveBeenCalledWith("handler-called");
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              botName: "demo",
              apiKey: "secret-token",
              envHasApiKey: "secret-token",
              region: "us",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });

  it("maps unexpected handler failures to internal errors", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "explode",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => {
            throw new Error("Boom.");
          },
        }),
      ],
    });

    const server = createMCPServer(root, {
      name: "cmdkit-test",
      version: "1.0.0",
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "explode",
        arguments: {},
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INTERNAL,
        });
        expect((error as Error).message).toContain("Boom.");
        return true;
      });
    } finally {
      await cleanup();
    }
  });
});
