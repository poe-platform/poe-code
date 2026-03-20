import { describe, expect, it, vi } from "vitest";
import type { AcpModel, AcpModelResponse } from "./runtime/acp-core.js";
import { agent } from "./agent.js";
import type { AcpEvent } from "./runtime/types.js";

const stdioTransportConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(() => vi.fn<(transport: unknown) => Promise<void>>());
const mcpClientListToolsMock = vi.hoisted(
  () =>
    vi.fn<
      (params?: { cursor?: string }) => Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>
    >(),
);
const mcpClientCallToolMock = vi.hoisted(
  () =>
    vi.fn<
      (
        params: { name: string; arguments?: Record<string, unknown> },
        options?: { signal?: AbortSignal },
      ) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>
    >(),
);
const mcpClientCloseMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {
    constructor(options: unknown) {
      stdioTransportConstructorMock(options);
    }
  },
  McpClient: class {
    constructor() {}

    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }

    async listTools(params?: {
      cursor?: string;
    }): Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }> {
      return mcpClientListToolsMock(params);
    }

    async callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      options?: { signal?: AbortSignal },
    ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
      return mcpClientCallToolMock(params, options);
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  },
}));

function createModel(responses: Array<AcpModelResponse | Error>, capturedTools: string[]): AcpModel {
  const queue = [...responses];

  return {
    complete: vi.fn(async request => {
      capturedTools.push(...request.tools.map(tool => tool.name));

      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected model call");
      }

      if (next instanceof Error) {
        throw next;
      }

      return next;
    }),
  };
}

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("agent builder", () => {
  it("keeps reused builders isolated and immutable", async () => {
    const memory = () => ({
      name: "memory",
      tools: [{ name: "memory.save", call: () => "ok" }],
    });

    const web = () => ({
      name: "web",
      tools: [{ name: "web.search", call: () => "ok" }],
    });

    const docTools = () => ({
      name: "doc-tools",
      tools: [{ name: "doc.write", call: () => "ok" }],
    });

    const base = agent().model("gpt-5").use(memory());
    const researcher = base.use(web());
    const writer = base.use(docTools());

    const baseTools: string[] = [];
    const researcherTools: string[] = [];
    const writerTools: string[] = [];

    const response: AcpModelResponse = {
      message: {
        content: "done",
        toolCalls: [],
      },
    };

    await base.run("base", { acpModel: createModel([response], baseTools) });
    await researcher.run("research", { acpModel: createModel([response], researcherTools) });
    await writer.run("write", { acpModel: createModel([response], writerTools) });

    expect(baseTools).toEqual(["memory.save"]);
    expect(researcherTools).toEqual(["memory.save", "web.search"]);
    expect(writerTools).toEqual(["memory.save", "doc.write"]);
  });

  it("defensively clones plugin configs on .use", async () => {
    const plugin = {
      name: "base-plugin",
      tools: [{ name: "alpha.tool", call: () => "ok" }],
    };

    const configured = agent().model("gpt-5").use(plugin);

    plugin.name = "mutated";
    plugin.tools.push({ name: "beta.tool", call: () => "ok" });

    const tools: string[] = [];

    await configured.run("hello", {
      acpModel: createModel(
        [
          {
            message: {
              content: "done",
              toolCalls: [],
            },
          },
        ],
        tools,
      ),
    });

    expect(tools).toEqual(["alpha.tool"]);
  });

  it("defensively clones nested tool schemas on .use", async () => {
    const plugin = {
      name: "schema-plugin",
      tools: [
        {
          name: "schema.tool",
          inputSchema: {
            type: "object",
            properties: {
              stable: { type: "string" },
            },
          },
          call: () => "ok",
        },
      ],
    };

    const configured = agent().model("gpt-5").use(plugin);

    const schema = plugin.tools[0]?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    schema.properties = {
      ...(schema.properties ?? {}),
      leaked: { type: "number" },
    };

    const capturedSchemas: unknown[] = [];

    await configured.run("hello", {
      acpModel: {
        complete: vi.fn(async request => {
          capturedSchemas.push(request.tools[0]?.inputSchema);

          return {
            message: {
              content: "done",
              toolCalls: [],
            },
          };
        }),
      },
    });

    expect(capturedSchemas[0]).toEqual({
      type: "object",
      properties: {
        stable: { type: "string" },
      },
    });
  });

  it("runs plugin setup in dependency-topological order", async () => {
    const setupOrder: string[] = [];

    const alpha = {
      name: "alpha",
      setup() {
        setupOrder.push("alpha");
      },
    };

    const beta = {
      name: "beta",
      dependencies: ["alpha"],
      setup() {
        setupOrder.push("beta");
      },
    };

    await agent()
      .model("gpt-5")
      .use(beta)
      .use(alpha)
      .run("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "done",
                toolCalls: [],
              },
            },
          ],
          [],
        ),
      });

    expect(setupOrder).toEqual(["alpha", "beta"]);
  });

  it("throws when plugin dependency is missing", async () => {
    await expect(
      agent()
        .model("gpt-5")
        .use({
          name: "needs-alpha",
          dependencies: ["alpha"],
        })
        .run("hello", {
          acpModel: createModel(
            [
              {
                message: {
                  content: "done",
                  toolCalls: [],
                },
              },
            ],
            [],
          ),
        }),
    ).rejects.toThrow('Unknown plugin dependency "alpha" for plugin "needs-alpha".');
  });

  it("adds MCP configs via .mcp() as plugin setup entries", async () => {
    stdioTransportConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCallToolMock.mockReset();
    mcpClientCloseMock.mockReset();

    mcpClientConnectMock.mockResolvedValue(undefined);
    mcpClientCloseMock.mockResolvedValue(undefined);
    mcpClientListToolsMock.mockResolvedValue({
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ],
    });

    const tools: string[] = [];

    await agent()
      .model("gpt-5")
      .mcp({
        name: "repo",
        command: "node",
        args: ["server.js"],
      })
      .run("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "done",
                toolCalls: [],
              },
            },
          ],
          tools,
        ),
      });

    expect(stdioTransportConstructorMock).toHaveBeenCalledWith({
      command: "node",
      args: ["server.js"],
      env: undefined,
    });
    expect(mcpClientConnectMock).toHaveBeenCalledTimes(1);
    expect(tools).toEqual(["repo.search"]);
    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
  });

  it("aborts in-flight MCP tool calls and rejects run with AbortError", async () => {
    stdioTransportConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCallToolMock.mockReset();
    mcpClientCloseMock.mockReset();

    mcpClientConnectMock.mockResolvedValue(undefined);
    mcpClientCloseMock.mockResolvedValue(undefined);
    mcpClientListToolsMock.mockResolvedValue({
      tools: [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ],
    });
    mcpClientCallToolMock.mockImplementation(
      async (
        _params: { name: string; arguments?: Record<string, unknown> },
        options?: { signal?: AbortSignal },
      ) => {
        const signal = options?.signal;
        if (!signal) {
          throw new Error("missing signal");
        }

        if (signal.aborted) {
          throw new Error("tool aborted");
        }

        await new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("tool aborted"));
            },
            { once: true },
          );
        });
      },
    );

    const model = createModel(
      [
        {
          message: {
            content: "",
            toolCalls: [
              {
                id: "tool-1",
                tool: "repo.search",
                args: { query: "tests" },
              },
            ],
          },
        },
      ],
      [],
    );
    const controller = new AbortController();
    const runPromise = agent()
      .model("gpt-5")
      .mcp({
        name: "repo",
        command: "node",
        args: ["server.js"],
      })
      .run("hello", {
        acpModel: model,
        signal: controller.signal,
      });

    await vi.waitFor(() => {
      expect(mcpClientCallToolMock).toHaveBeenCalledTimes(1);
    });

    controller.abort(new Error("stop"));

    await expect(runPromise).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mcpClientCallToolMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(mcpClientCallToolMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
  });

  it("streams ACP events and includes session.complete", async () => {
    const events = await collectEvents(
      agent()
        .model("gpt-5")
        .stream("hello", {
          acpModel: createModel(
            [
              {
                message: {
                  content: "done",
                  toolCalls: [],
                },
              },
            ],
            [],
          ),
        }),
    );

    expect(events.map(event => event.type)).toEqual(["message.delta", "session.complete"]);
  });

  it("exposes ACP sessions and requires caller acknowledgements for tool intents", async () => {
    const call = vi.fn(() => "should-not-run");
    const capturedTools: string[] = [];
    const session = await agent()
      .model("gpt-5")
      .use({
        name: "tooling",
        tools: [{ name: "repo.search", call }],
      })
      .acp("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "tool-1",
                    tool: "repo.search",
                    args: { query: "tests" },
                  },
                ],
              },
            },
            {
              message: {
                content: "done",
                toolCalls: [],
              },
            },
          ],
          capturedTools,
        ),
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        session.acknowledge(event.intentId, {
          status: "success",
          result: { ok: true },
        });
      }
    }

    expect(capturedTools).toEqual(["repo.search", "repo.search"]);
    expect(call).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);
  });

  it("cancels ACP sessions via dispose and emits AbortError", async () => {
    const session = await agent()
      .model("gpt-5")
      .use({
        name: "tooling",
        tools: [{ name: "repo.search", call: () => "should-not-run" }],
      })
      .acp("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "tool-1",
                    tool: "repo.search",
                    args: { query: "tests" },
                  },
                ],
              },
            },
          ],
          [],
        ),
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        await session.dispose();
      }
    }

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("tool.intent");
    expect(events[1]?.type).toBe("session.error");
    if (events[1]?.type === "session.error") {
      expect(events[1].error.name).toBe("AbortError");
    }
  });

  it("injects resume messages before starting ACP sessions", async () => {
    const model = {
      complete: vi.fn(async request => {
        const userMessages = request.messages.filter(message => message.role === "user");
        expect(userMessages.map(message => message.content)).toEqual(["previous", "next"]);

        return {
          message: {
            content: "done",
            toolCalls: [],
          },
        };
      }),
    } satisfies AcpModel;

    const session = await agent().model("gpt-5").acp("next", {
      acpModel: model,
      resume: {
        output: "ignored",
        toolCalls: [],
        messages: [{ role: "user", content: "previous" }],
      },
    });

    const events = await collectEvents(session.events);

    expect(events.map(event => event.type)).toEqual(["message.delta", "session.complete"]);
    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown and duplicate ACP acknowledgements", async () => {
    const session = await agent()
      .model("gpt-5")
      .acp("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "tool-1",
                    tool: "repo.search",
                    args: { query: "tests" },
                  },
                ],
              },
            },
            {
              message: {
                content: "done",
                toolCalls: [],
              },
            },
          ],
          [],
        ),
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        expect(() =>
          session.acknowledge("missing-intent", {
            status: "success",
            result: { ok: true },
          }),
        ).toThrow("Unknown or already acknowledged tool intent: missing-intent");

        session.acknowledge(event.intentId, {
          status: "success",
          result: { ok: true },
        });

        expect(() =>
          session.acknowledge(event.intentId, {
            status: "success",
            result: { ok: true },
          }),
        ).toThrow(`Unknown or already acknowledged tool intent: ${event.intentId}`);
      }
    }

    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);
  });

  it("injects resume messages before running", async () => {
    const model = {
      complete: vi.fn(async request => {
        const userMessages = request.messages.filter(message => message.role === "user");
        expect(userMessages.map(message => message.content)).toEqual(["previous", "next"]);

        return {
          message: {
            content: "done",
            toolCalls: [],
          },
        };
      }),
    } satisfies AcpModel;

    await agent().model("gpt-5").run("next", {
      acpModel: model,
      resume: {
        output: "ignored",
        toolCalls: [],
        messages: [{ role: "user", content: "previous" }],
      },
    });

    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("activates skill tools from RunOptions.skills", async () => {
    const withSkillModel = {
      complete: vi.fn(async request => {
        expect(request.tools.map(tool => tool.name)).toEqual(["always-visible", "repo.search"]);
        return {
          message: {
            content: "done",
            toolCalls: [],
          },
        };
      }),
    } satisfies AcpModel;

    const withoutSkillModel = {
      complete: vi.fn(async request => {
        expect(request.tools.map(tool => tool.name)).toEqual(["always-visible"]);
        return {
          message: {
            content: "done",
            toolCalls: [],
          },
        };
      }),
    } satisfies AcpModel;

    const configured = agent()
      .model("gpt-5")
      .use({
        name: "skill-tools",
        tools: [
          { name: "always-visible", call: () => "ok" },
          { name: "repo.search", visibility: "skill", call: () => "ok" },
        ],
      });

    await configured.run("hello", { acpModel: withoutSkillModel });
    await configured.run("hello", { acpModel: withSkillModel, skills: ["repo"] });
  });

  it("disposes plugin resources when run fails", async () => {
    const dispose = vi.fn(async () => undefined);

    await expect(
      agent()
        .model("gpt-5")
        .use({
          name: "resourceful",
          dispose,
        })
        .run("hello", {
          acpModel: createModel([new Error("model boom")], []),
        }),
    ).rejects.toThrow("model boom");

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("emits session.error when stream preparation fails", async () => {
    const events = await collectEvents(
      agent()
        .model("gpt-5")
        .use({
          name: "needs-alpha",
          dependencies: ["alpha"],
        })
        .stream("hello", {
          acpModel: createModel(
            [
              {
                message: {
                  content: "done",
                  toolCalls: [],
                },
              },
            ],
            [],
          ),
        }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");

    if (events[0]?.type === "session.error") {
      expect(events[0].error.message).toContain(
        'Unknown plugin dependency "alpha" for plugin "needs-alpha".',
      );
    }
  });
});
