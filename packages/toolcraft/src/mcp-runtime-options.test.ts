import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand, type HandlerFs } from "./index.js";
import { createHumanInLoop } from "./human-in-loop/index.js";
import { createMCPServer } from "./mcp.js";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";

describe("createMCPServer stream lifecycle", () => {
  it("lists typed streams, emits notifications, and cleans up on disconnect", async () => {
    const cleanup = vi.fn();
    const server = createMCPServer(
      defineGroup({
        name: "devices",
        children: [
          defineStreamCommand({
            name: "watch",
            scope: ["mcp"],
            params: S.Object({ deviceId: S.String() }),
            event: S.Object({ state: S.String() }),
            async *handler({ params, signal, status }) {
              try {
                status({ type: "connected" });
                yield { state: `${params.deviceId}:online` };
                await new Promise<void>((resolve) =>
                  signal.addEventListener("abort", () => resolve(), { once: true })
                );
              } finally {
                cleanup();
              }
            }
          })
        ]
      }),
      { name: "toolcraft-test", version: "1.0.0" }
    );
    const notifications: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const session = server.createMessageSession((notification) => {
      notifications.push(notification);
    });
    await session.handleMessage("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" }
    });
    await session.handleMessage("notifications/initialized");

    await expect(session.handleMessage("toolcraft/streams/list")).resolves.toMatchObject({
      result: {
        streams: [
          {
            name: "devices__watch",
            eventSchema: {
              type: "object",
              properties: { state: { type: "string" } },
              required: ["state"]
            }
          }
        ]
      }
    });
    const subscription = await session.handleMessage("toolcraft/streams/subscribe", {
      name: "devices__watch",
      arguments: { device_id: "lamp" }
    });
    expect(subscription).toMatchObject({ result: { subscriptionId: expect.any(String) } });
    await vi.waitFor(() => {
      expect(notifications).toContainEqual(
        expect.objectContaining({
          method: "notifications/toolcraft/stream",
          params: expect.objectContaining({ type: "data", event: { state: "lamp:online" } })
        })
      );
    });

    session.close();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });
});

async function createClient(server: ReturnType<typeof createMCPServer>) {
  return createSdkTestPair(
    server,
    () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
  );
}

describe("createMCPServer human-in-loop wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const gatedRoot = defineGroup({
    name: "root",
    children: [
      defineCommand({
        name: "deploy",
        scope: ["mcp"],
        params: S.Object({
          target: S.String()
        }),
        humanInLoop: {
          mode: "sync",
          message: ({ params }: { params: { target: string } }) => `Deploy to ${params.target}?`
        },
        handler: async ({ params }: { params: { target: string } }) => ({
          deployed: params.target
        })
      })
    ]
  });

  it("routes gated tools through the wired runtime provider", async () => {
    const requestApproval = vi.fn(async () => ({ outcome: "approved" as const }));
    const server = createMCPServer(gatedRoot, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      humanInLoop: createHumanInLoop({
        provider: { id: "mcp-test", requestApproval }
      })
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "deploy",
          arguments: {
            target: "prod"
          }
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              deployed: "prod"
            })
          }
        ]
      });
      expect(requestApproval).toHaveBeenCalledWith({
        message: "Deploy to prod?",
        declineInputPrompt: undefined
      });
    } finally {
      await cleanup();
    }
  });

  it("throws at startup when a tool declares humanInLoop and no runtime is wired", () => {
    expect(() =>
      createMCPServer(gatedRoot, {
        name: "toolcraft-test",
        version: "1.0.0"
      })
    ).toThrow("command 'deploy' declares humanInLoop but no runtime is wired");
  });
});

describe("createMCPServer tool metadata", () => {
  it("lists command titles and all standard tool annotations", async () => {
    const annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    };
    const command = defineCommand({
      name: "get",
      title: "Get calendar event",
      annotations,
      scope: ["mcp"],
      params: S.Object({ eventId: S.String() }),
      result: S.Object({ title: S.String() }),
      handler: async () => ({ title: "Planning" })
    });
    const server = createMCPServer(
      defineGroup({ name: "calendar", children: [command] }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      }
    );
    annotations.readOnlyHint = false;
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "get",
            title: "Get calendar event",
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false
            },
            outputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"]
            }
          }
        ]
      });

      await expect(client.callTool({ name: "get", arguments: { event_id: "event-1" } })).resolves
        .toMatchObject({ structuredContent: { title: "Planning" } });
    } finally {
      await cleanup();
    }
  });

  it("leaves tools unchanged when commands omit optional metadata", async () => {
    const server = createMCPServer(
      defineGroup({
        name: "calendar",
        children: [
          defineCommand({
            name: "list",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async () => []
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      const response = await client.listTools();
      expect(response.tools[0]).not.toHaveProperty("title");
      expect(response.tools[0]).not.toHaveProperty("annotations");
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer fetch runtime options plumbing", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes options.fetch to command contexts", async () => {
    const injectedFetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json"
          }
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
            }
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        fetch: injectedFetch
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "load",
          arguments: {}
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true
            })
          }
        ]
      });
      expect(injectedFetch).toHaveBeenCalledWith("https://api.example.com/items");
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer hermetic runtime options plumbing", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses options.env for secrets, requirements, and handler env and options.fs for handler fs", async () => {
    const injectedEnv = {
      POE_API_KEY: "auth-token",
      TOOL_TOKEN: "secret-token",
      TOOL_VALUE: "visible-value"
    };
    const injectedFs = {
      readFile: vi.fn(async () => "contents"),
      writeFile: vi.fn(async () => undefined),
      exists: vi.fn(async () => true),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
      rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    } satisfies HandlerFs;
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "inspect",
            scope: ["mcp"],
            params: S.Object({}),
            secrets: {
              token: {
                env: "TOOL_TOKEN"
              }
            },
            requires: {
              auth: true
            },
            handler: async ({ env, fs, secrets }) => {
              expect(env.get("TOOL_VALUE")).toBe("visible-value");
              expect(fs).toBe(injectedFs);
              expect(secrets.token).toBe("secret-token");
              return fs.readFile("/virtual/input.txt");
            }
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        env: injectedEnv,
        fs: injectedFs
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "inspect", arguments: {} })).resolves.toEqual({
        content: [{ type: "text", text: "contents" }]
      });
      expect(injectedFs.readFile).toHaveBeenCalledWith("/virtual/input.txt");
    } finally {
      await cleanup();
    }
  });

  it("passes options.apiVersion to command requirement checks", async () => {
    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            scope: ["mcp"],
            params: S.Object({}),
            requires: {
              apiVersion: ">=1.2.3"
            },
            handler: async () => "deployed"
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        apiVersion: "1.2.3"
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "deploy", arguments: {} })).resolves.toEqual({
        content: [{ type: "text", text: "deployed" }]
      });
    } finally {
      await cleanup();
    }
  });
});

describe("createMCPServer diagnostic runtime options plumbing", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes log level and logger through command contexts without adding MCP arguments", async () => {
    const events: Array<{ level: string; message: string }> = [];

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async ({ diagnostics }) => {
              expect(diagnostics.level).toBe("info");
              diagnostics.emit({ level: "debug", message: "debug suppressed" });
              diagnostics.emit({ level: "info", message: "deploying", category: "progress" });
              return "deployed";
            }
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        logLevel: "info",
        logger: (event) => {
          events.push({ level: event.level, message: event.message });
        }
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "deploy",
            inputSchema: {
              properties: {}
            }
          }
        ]
      });
      await expect(
        client.callTool({
          name: "deploy",
          arguments: {}
        })
      ).resolves.toEqual({
        content: [
          {
            type: "text",
            text: "deployed"
          }
        ]
      });
    } finally {
      await cleanup();
    }

    expect(events).toEqual([{ level: "info", message: "deploying" }]);
  });
});

describe("createMCPServer typed result schemas", () => {
  beforeEach(() => {
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advertises result schemas and returns structured content with matching fallback text", async () => {

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "inspect",
            scope: ["mcp"],
            params: S.Object({
              resourceId: S.String()
            }),
            result: S.Object({
              resourceId: S.String(),
              displayName: S.String(),
              checks: S.Array(
                S.Object({
                  checkName: S.String(),
                  passed: S.Boolean()
                })
              )
            }),
            handler: async ({ params }) => ({
              resourceId: params.resourceId,
              displayName: "Fixture",
              checks: [{ checkName: "exists", passed: true }]
            })
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        casing: "snake"
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
                      passed: { type: "boolean" }
                    },
                    required: ["check_name", "passed"]
                  }
                }
              },
              required: ["resource_id", "display_name", "checks"]
            }
          }
        ]
      });

      const result = (await client.callTool({
        name: "inspect",
        arguments: { resource_id: "res-1" }
      })) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };

      expect(result.structuredContent).toEqual({
        resource_id: "res-1",
        display_name: "Fixture",
        checks: [{ check_name: "exists", passed: true }]
      });
      expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    } finally {
      await cleanup();
    }
  });

  it("appends command examples to MCP tool descriptions", async () => {

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "send",
            description: "Send a message.",
            scope: ["mcp"],
            params: S.Object({
              body: S.String()
            }),
            examples: [
              {
                title: "Send a greeting",
                params: { body: "hello" }
              }
            ],
            handler: async () => ({ ok: true })
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: "send",
            description: expect.stringContaining("Examples:\n- Send a greeting: send body=hello")
          }
        ]
      });
    } finally {
      await cleanup();
    }
  });

  it("applies MCP casing to result oneOf branches and record value schemas", async () => {

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
                  ship: S.Object({ streetAddress: S.String() })
                }
              }),
              labels: S.Record(
                S.Object({
                  displayName: S.String()
                })
              ),
              contact: S.Union([
                S.Object({ emailAddress: S.String() }),
                S.Object({ phoneNumber: S.String() })
              ])
            }),
            handler: async () => ({
              delivery: {
                deliveryKind: "ship",
                streetAddress: "1 Main St"
              },
              labels: {
                primary: { displayName: "Primary" }
              },
              contact: {
                emailAddress: "ops@example.com"
              }
            })
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true,
        casing: "snake"
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
                        street_address: { type: "string" }
                      }),
                      required: expect.arrayContaining(["delivery_kind", "street_address"])
                    })
                  ])
                },
                labels: {
                  additionalProperties: {
                    properties: {
                      display_name: { type: "string" }
                    },
                    required: ["display_name"],
                    type: "object"
                  },
                  type: "object"
                },
                contact: {
                  oneOf: expect.arrayContaining([
                    expect.objectContaining({
                      properties: {
                        email_address: { type: "string" }
                      }
                    })
                  ])
                }
              }
            }
          }
        ]
      });

      const result = (await client.callTool({ name: "route", arguments: {} })) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
      };
      const expected = {
        delivery: {
          delivery_kind: "ship",
          street_address: "1 Main St"
        },
        labels: {
          primary: { display_name: "Primary" }
        },
        contact: {
          email_address: "ops@example.com"
        }
      };

      expect(result.structuredContent).toEqual(expected);
      expect(JSON.parse(result.content[0]!.text)).toEqual(expected);
    } finally {
      await cleanup();
    }
  });

  it("keeps commands without result schemas text-only", async () => {

    const server = createMCPServer(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "load",
            scope: ["mcp"],
            params: S.Object({}),
            handler: async () => ({ ok: true })
          })
        ]
      }),
      {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      }
    );
    const { client, cleanup } = await createClient(server);

    try {
      const result = (await client.callTool({ name: "load", arguments: {} })) as {
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
