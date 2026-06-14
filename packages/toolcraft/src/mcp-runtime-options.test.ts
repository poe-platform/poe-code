import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";

const invokeWithHumanInLoopMock = vi.hoisted(() => vi.fn());

vi.mock("./human-in-loop/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./human-in-loop/index.js")>();

  return {
    ...actual,
    invokeWithHumanInLoop: invokeWithHumanInLoopMock,
  };
});

const { createMCPServer } = await import("./mcp.js");
const { McpClient, createSdkTestPair } = await import("tiny-mcp-client");

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

describe("createMCPServer human-in-loop runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the normalized runtime options object to the gate when options.humanInLoop is omitted", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (_command, context, runtimeOptions) => {
      expect(runtimeOptions).toBe(context.runtimeOptions);
      expect(runtimeOptions).toEqual({});

      return {
        deployed: context.params.target,
      };
    });

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            scope: ["mcp"],
            params: S.Object({
              target: S.String(),
            }),
            handler: async () => "should not run",
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "deploy",
          arguments: {
            target: "prod",
          },
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              deployed: "prod",
            }),
          },
        ],
      });
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer fetch runtime options plumbing", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes options.fetch to command contexts", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) => command.handler(context));
    const injectedFetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "load",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async ({ fetch }) => {
              expect(fetch).toBe(injectedFetch);
              const response = await fetch("https://api.example.com/items");
              return response.json();
            },
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        fetch: injectedFetch,
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "load",
          arguments: {},
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
            }),
          },
        ],
      });
      expect(injectedFetch).toHaveBeenCalledWith("https://api.example.com/items");
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer typed result schemas", () => {
  beforeEach(() => {
    invokeWithHumanInLoopMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advertises result schemas and returns structured content with matching fallback text", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) => command.handler(context));

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "inspect",
            scope: ["mcp"],
            params: S.Object({
              resourceId: S.String(),
            }),
            result: S.Object({
              resourceId: S.String(),
              displayName: S.String(),
              checks: S.Array(S.Object({
                checkName: S.String(),
                passed: S.Boolean(),
              })),
            }),
            handler: async ({ params }) => ({
              resourceId: params.resourceId,
              displayName: "Fixture",
              checks: [{ checkName: "exists", passed: true }],
            }),
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        casing: "snake",
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "inspect",
            outputSchema: {
              type: "object",
              properties: {
                resource_id: { type: "string" },
                display_name: { type: "string" },
                checks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      check_name: { type: "string" },
                      passed: { type: "boolean" },
                    },
                    required: ["check_name", "passed"],
                  },
                },
              },
              required: ["resource_id", "display_name", "checks"],
            },
          },
        ],
      });

      const result = await client.callTool({
        name: "inspect",
        arguments: { resource_id: "res-1" },
      }) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };

      expect(result.structuredContent).toEqual({
        resource_id: "res-1",
        display_name: "Fixture",
        checks: [{ check_name: "exists", passed: true }],
      });
      expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    } finally {
      await cleanup();
    }
  });

  it("applies MCP casing to result oneOf branches and record value schemas", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) => command.handler(context));

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "route",
            scope: ["mcp"],
            params: S.Object({}),
            result: S.Object({
              delivery: S.OneOf({
                discriminator: "deliveryKind",
                branches: {
                  pickup: S.Object({ pickupAt: S.String() }),
                  ship: S.Object({ streetAddress: S.String() }),
                },
              }),
              labels: S.Record(S.Object({
                displayName: S.String(),
              })),
              contact: S.Union([
                S.Object({ emailAddress: S.String() }),
                S.Object({ phoneNumber: S.String() }),
              ]),
            }),
            handler: async () => ({
              delivery: {
                deliveryKind: "ship",
                streetAddress: "1 Main St",
              },
              labels: {
                primary: { displayName: "Primary" },
              },
              contact: {
                emailAddress: "ops@example.com",
              },
            }),
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        casing: "snake",
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "route",
            outputSchema: {
              properties: {
                delivery: {
                  oneOf: expect.arrayContaining([
                    expect.objectContaining({
                      properties: expect.objectContaining({
                        delivery_kind: { enum: ["ship"], type: "string" },
                        street_address: { type: "string" },
                      }),
                      required: expect.arrayContaining(["delivery_kind", "street_address"]),
                    }),
                  ]),
                },
                labels: {
                  additionalProperties: {
                    properties: {
                      display_name: { type: "string" },
                    },
                    required: ["display_name"],
                    type: "object",
                  },
                  type: "object",
                },
                contact: {
                  oneOf: expect.arrayContaining([
                    expect.objectContaining({
                      properties: {
                        email_address: { type: "string" },
                      },
                    }),
                  ]),
                },
              },
            },
          },
        ],
      });

      const result = await client.callTool({ name: "route", arguments: {} }) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };
      const expected = {
        delivery: {
          delivery_kind: "ship",
          street_address: "1 Main St",
        },
        labels: {
          primary: { display_name: "Primary" },
        },
        contact: {
          email_address: "ops@example.com",
        },
      };

      expect(result.structuredContent).toEqual(expected);
      expect(JSON.parse(result.content[0]!.text)).toEqual(expected);
    } finally {
      await cleanup();
    }
  });

  it("keeps commands without result schemas text-only", async () => {
    invokeWithHumanInLoopMock.mockImplementation(async (command, context) => command.handler(context));

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "load",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async () => ({ ok: true }),
          }),
        ],
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({ name: "load", arguments: {} }) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };

      expect(result).not.toHaveProperty("structuredContent");
      expect(JSON.parse(result.content[0]!.text)).toEqual({ ok: true });
    } finally {
      await cleanup();
    }
  });
});
