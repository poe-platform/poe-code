import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import maxIterationsPlugin from "./plugins/poe-agent-plugin-max-iterations.js";
import type { AcpModel, AcpModelResponse } from "./runtime/acp-core.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "./testing/model-response.js";
import { agent } from "./agent.js";
import type { AcpEvent } from "./runtime/types.js";
import { InvalidToolNameError } from "./runtime/tool-names.js";
import { loadSystemPrompt, loadSystemPromptSync } from "./system-prompt.js";

const stdioTransportConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(() => vi.fn<(transport: unknown) => Promise<void>>());
const mcpClientListToolsMock = vi.hoisted(() =>
  vi.fn<
    (params?: {
      cursor?: string;
    }) => Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>
  >()
);
const mcpClientCallToolMock = vi.hoisted(() =>
  vi.fn<
    (
      params: { name: string; arguments?: Record<string, unknown> },
      options?: { signal?: AbortSignal }
    ) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>
  >()
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
      options?: { signal?: AbortSignal }
    ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
      return mcpClientCallToolMock(params, options);
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  }
}));

function createModel(
  responses: Array<LegacyAcpModelResponse | AcpModelResponse | Error>,
  capturedTools: string[]
): AcpModel {
  const queue = [...responses];

  return {
    complete: vi.fn(async (request) => {
      capturedTools.push(...request.tools.map((tool) => tool.name));

      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected model call");
      }

      if (next instanceof Error) {
        throw next;
      }

      return toAcpModelResponse(next);
    })
  };
}

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function createDeferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: (() => void) | undefined;

  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });

  return {
    promise,
    resolve: resolve ?? (() => undefined)
  };
}

describe("agent builder", () => {
  it("preserves reasoning fields between model iterations when using Poe fetch transport", async () => {
    const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const responses = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              reasoning_content: "Need to create the file first.",
              reasoning: "Need to create the file first.",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "edit_file",
                    arguments: '{"command": "create", "path": "/workspace/test-document.txt"}'
                  }
                }
              ]
            }
          }
        ]
      },
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "done"
            }
          }
        ]
      }
    ];

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> });
      const payload = responses.shift();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await agent()
      .model("anthropic/claude-sonnet-4.6")
      .use({
        name: "edit-plugin",
        tools: [
          {
            name: "edit_file",
            inputSchema: {
              type: "object",
              properties: {}
            },
            call: async () => "Created file: test-document.txt"
          }
        ]
      })
      .run("Create a file", {
        apiKey: "test-key",
        baseUrl: "http://localhost:3456",
        fetch: fetchMock
      });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondAssistantMessage = requests[1]?.messages?.find(
      (message) => message.role === "assistant"
    );
    expect(secondAssistantMessage).toEqual(
      expect.objectContaining({
        reasoning_content: "Need to create the file first.",
        reasoning: "Need to create the file first."
      })
    );
  });

  it("serializes multimodal tool results for Poe chat completions requests", async () => {
    const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const responses = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"diagram.png"}'
                  }
                }
              ]
            }
          }
        ]
      },
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "done"
            }
          }
        ]
      }
    ];

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> });
      const payload = responses.shift();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await agent()
      .model("anthropic/claude-sonnet-4.6")
      .use({
        name: "files",
        tools: [
          {
            name: "read_file",
            inputSchema: {
              type: "object",
              properties: {}
            },
            call: async () => [
              { type: "text", text: "Screenshot captured" },
              { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
              {
                type: "error",
                code: "parse_error",
                message: "Retry with valid JSON",
                retriable: true
              }
            ]
          }
        ]
      })
      .run("Read the diagram", {
        apiKey: "test-key",
        baseUrl: "http://localhost:3456",
        fetch: fetchMock
      });

    const toolMessage = requests[1]?.messages?.find((message) => message.role === "tool");
    expect(toolMessage).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      name: "read_file",
      content: [
        { type: "text", text: "Screenshot captured" },
        {
          type: "image_url",
          image_url: {
            url: "data:image/png;base64,YmFzZTY0LWltYWdl"
          }
        },
        {
          type: "text",
          text: '{"type":"error","code":"parse_error","message":"Retry with valid JSON","retriable":true}'
        }
      ]
    });
  });

  it("keeps reused builders isolated and immutable", async () => {
    const memory = () => ({
      name: "memory",
      tools: [{ name: "memory_save", call: () => "ok" }]
    });

    const web = () => ({
      name: "web",
      tools: [{ name: "web_search", call: () => "ok" }]
    });

    const docTools = () => ({
      name: "doc-tools",
      tools: [{ name: "doc_write", call: () => "ok" }]
    });

    const base = agent().model("gpt-5").use(memory());
    const researcher = base.use(web());
    const writer = base.use(docTools());

    const baseTools: string[] = [];
    const researcherTools: string[] = [];
    const writerTools: string[] = [];

    const response: LegacyAcpModelResponse = {
      message: {
        content: "done",
        toolCalls: []
      }
    };

    await base.run("base", { acpModel: createModel([response], baseTools) });
    await researcher.run("research", { acpModel: createModel([response], researcherTools) });
    await writer.run("write", { acpModel: createModel([response], writerTools) });

    expect(baseTools).toEqual(["memory_save"]);
    expect(researcherTools).toEqual(["memory_save", "web_search"]);
    expect(writerTools).toEqual(["memory_save", "doc_write"]);
  });

  it("defensively clones plugin configs on .use", async () => {
    const plugin = {
      name: "base-plugin",
      tools: [{ name: "alpha_tool", call: () => "ok" }]
    };

    const configured = agent().model("gpt-5").use(plugin);

    plugin.name = "mutated";
    plugin.tools.push({ name: "beta_tool", call: () => "ok" });

    const tools: string[] = [];

    await configured.run("hello", {
      acpModel: createModel(
        [
          {
            message: {
              content: "done",
              toolCalls: []
            }
          }
        ],
        tools
      )
    });

    expect(tools).toEqual(["alpha_tool"]);
  });

  it("defensively clones nested tool schemas on .use", async () => {
    const plugin = {
      name: "schema-plugin",
      tools: [
        {
          name: "schema_tool",
          inputSchema: {
            type: "object",
            properties: {
              stable: { type: "string" }
            }
          },
          call: () => "ok"
        }
      ]
    };

    const configured = agent().model("gpt-5").use(plugin);

    const schema = plugin.tools[0]?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    schema.properties = {
      ...(schema.properties ?? {}),
      leaked: { type: "number" }
    };

    const capturedSchemas: unknown[] = [];

    await configured.run("hello", {
      acpModel: {
        complete: vi.fn(async (request) => {
          capturedSchemas.push(request.tools[0]?.inputSchema);

          return toAcpModelResponse({
            message: {
              content: "done",
              toolCalls: []
            }
          });
        })
      }
    });

    expect(capturedSchemas[0]).toEqual({
      type: "object",
      properties: {
        stable: { type: "string" }
      }
    });
  });

  it("adds inline tools through .tools", async () => {
    const tools: string[] = [];

    await agent()
      .model("gpt-5")
      .tools({
        name: "inline_tool",
        call: () => "ok"
      })
      .run("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "done",
                toolCalls: []
              }
            }
          ],
          tools
        )
      });

    expect(tools).toEqual(["inline_tool"]);
  });

  it("rejects invalid tool names added through .tools", () => {
    expect(() =>
      agent().tools({
        name: "invalid.tool",
        call: () => "ok"
      })
    ).toThrowError(InvalidToolNameError);
  });

  it("runs plugin setup in dependency-topological order", async () => {
    const setupOrder: string[] = [];

    const alpha = {
      name: "alpha",
      setup() {
        setupOrder.push("alpha");
      }
    };

    const beta = {
      name: "beta",
      dependencies: ["alpha"],
      setup() {
        setupOrder.push("beta");
      }
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
                toolCalls: []
              }
            }
          ],
          []
        )
      });

    expect(setupOrder).toEqual(["alpha", "beta"]);
  });

  it("throws when plugin dependency is missing", async () => {
    await expect(
      agent()
        .model("gpt-5")
        .use({
          name: "needs-alpha",
          dependencies: ["alpha"]
        })
        .run("hello", {
          acpModel: createModel(
            [
              {
                message: {
                  content: "done",
                  toolCalls: []
                }
              }
            ],
            []
          )
        })
    ).rejects.toThrow('Unknown plugin dependency "alpha" for plugin "needs-alpha".');
  });

  it("adds MCP configs via .mcp() as plugin setup entries", async () => {
    stdioTransportConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCallToolMock.mockReset();
    mcpClientCloseMock.mockReset();

    const repoSearchToolName = ["repo", "search"].join("_");

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
              query: { type: "string" }
            }
          }
        }
      ]
    });

    const tools: string[] = [];

    await agent()
      .model("gpt-5")
      .mcp({
        name: "repo",
        command: "node",
        args: ["server.js"]
      })
      .run("hello", {
        acpModel: createModel(
          [
            {
              message: {
                content: "done",
                toolCalls: []
              }
            }
          ],
          tools
        )
      });

    expect(stdioTransportConstructorMock).toHaveBeenCalledWith({
      command: "node",
      args: ["server.js"],
      env: undefined
    });
    expect(mcpClientConnectMock).toHaveBeenCalledTimes(1);
    expect(tools).toEqual([repoSearchToolName]);
    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
  });

  it("aborts in-flight MCP tool calls and rejects run with AbortError", async () => {
    const repoSearchToolName = ["repo", "search"].join("_");

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
              query: { type: "string" }
            }
          }
        }
      ]
    });
    mcpClientCallToolMock.mockImplementation(
      async (
        _params: { name: string; arguments?: Record<string, unknown> },
        options?: { signal?: AbortSignal }
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
            { once: true }
          );
        });
      }
    );

    const model = createModel(
      [
        {
          message: {
            content: "",
            toolCalls: [
              {
                id: "tool-1",
                tool: repoSearchToolName,
                args: { query: "tests" }
              }
            ]
          }
        }
      ],
      []
    );
    const controller = new AbortController();
    const runPromise = agent()
      .model("gpt-5")
      .mcp({
        name: "repo",
        command: "node",
        args: ["server.js"]
      })
      .run("hello", {
        acpModel: model,
        signal: controller.signal
      });

    await vi.waitFor(() => {
      expect(mcpClientCallToolMock).toHaveBeenCalledTimes(1);
    });

    controller.abort(new Error("stop"));

    await expect(runPromise).rejects.toMatchObject({
      name: "AbortError"
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
                  toolCalls: []
                }
              }
            ],
            []
          )
        })
    );

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);
  });

  it("exposes ACP sessions and requires caller acknowledgements for tool intents", async () => {
    const call = vi.fn(() => "should-not-run");
    const capturedTools: string[] = [];
    const session = await agent()
      .model("gpt-5")
      .use({
        name: "tooling",
        tools: [{ name: "repo_search", call }]
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
                    tool: "repo_search",
                    args: { query: "tests" }
                  }
                ]
              }
            },
            {
              message: {
                content: "done",
                toolCalls: []
              }
            }
          ],
          capturedTools
        )
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        session.acknowledge(event.intentId, {
          status: "success",
          result: { ok: true }
        });
      }
    }

    expect(capturedTools).toEqual(["repo_search", "repo_search"]);
    expect(call).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);
  });

  it("cancels ACP sessions via dispose and emits AbortError", async () => {
    const session = await agent()
      .model("gpt-5")
      .use({
        name: "tooling",
        tools: [{ name: "repo_search", call: () => "should-not-run" }]
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
                    tool: "repo_search",
                    args: { query: "tests" }
                  }
                ]
              }
            }
          ],
          []
        )
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

  it("lets caller host ACP tool execution and unblock the loop with acknowledgements", async () => {
    const dispose = vi.fn(async () => undefined);
    const executeLocally = vi.fn(async (event: Extract<AcpEvent, { type: "tool.intent" }>) => ({
      status: "success" as const,
      result: {
        local: true,
        args: event.args
      }
    }));
    let modelCallCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        modelCallCount += 1;

        if (modelCallCount === 1) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-1",
                  tool: "repo_search",
                  args: { query: "tests" }
                }
              ]
            }
          });
        }

        if (modelCallCount === 2) {
          return toAcpModelResponse({
            message: {
              content: "done",
              toolCalls: []
            }
          });
        }

        throw new Error("Unexpected model call");
      })
    };

    const session = await agent()
      .model("gpt-5")
      .use({
        name: "tooling",
        tools: [{ name: "repo_search", call: () => "should-not-run" }],
        dispose
      })
      .acp("Do something", {
        acpModel: model
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        expect(model.complete).toHaveBeenCalledTimes(1);
        session.acknowledge(event.intentId, await executeLocally(event));
      }
    }

    await session.dispose();

    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(executeLocally).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("injects resume messages before starting ACP sessions", async () => {
    const model = {
      complete: vi.fn(async (request) => {
        const userMessages = request.messages.filter((message) => message.role === "user");
        expect(userMessages.map((message) => message.content)).toEqual(["previous", "next"]);

        return toAcpModelResponse({
          message: {
            content: "done",
            toolCalls: []
          }
        });
      })
    } satisfies AcpModel;

    const session = await agent()
      .model("gpt-5")
      .acp("next", {
        acpModel: model,
        resume: {
          output: "ignored",
          toolCalls: [],
          messages: [{ role: "user", content: "previous" }]
        }
      });

    const events = await collectEvents(session.events);

    expect(events.map((event) => event.type)).toEqual(["message.delta", "session.complete"]);
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
                    tool: "repo_search",
                    args: { query: "tests" }
                  }
                ]
              }
            },
            {
              message: {
                content: "done",
                toolCalls: []
              }
            }
          ],
          []
        )
      });

    const events: AcpEvent[] = [];
    for await (const event of session.events) {
      events.push(event);

      if (event.type === "tool.intent") {
        expect(() =>
          session.acknowledge("missing-intent", {
            status: "success",
            result: { ok: true }
          })
        ).toThrow("Unknown or already acknowledged tool intent: missing-intent");

        session.acknowledge(event.intentId, {
          status: "success",
          result: { ok: true }
        });

        expect(() =>
          session.acknowledge(event.intentId, {
            status: "success",
            result: { ok: true }
          })
        ).toThrow(`Unknown or already acknowledged tool intent: ${event.intentId}`);
      }
    }

    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete"
    ]);
  });

  it("injects resume messages before running", async () => {
    const model = {
      complete: vi.fn(async (request) => {
        const userMessages = request.messages.filter((message) => message.role === "user");
        expect(userMessages.map((message) => message.content)).toEqual(["previous", "next"]);

        return toAcpModelResponse({
          message: {
            content: "done",
            toolCalls: []
          }
        });
      })
    } satisfies AcpModel;

    await agent()
      .model("gpt-5")
      .run("next", {
        acpModel: model,
        resume: {
          output: "ignored",
          toolCalls: [],
          messages: [{ role: "user", content: "previous" }]
        }
      });

    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("aborts externally, propagates signal to in-flight tools, and disposes once", async () => {
    const dispose = vi.fn(async () => undefined);
    const started = createDeferred();
    let capturedSignal: AbortSignal | undefined;
    const model = createModel(
      [
        {
          message: {
            content: "",
            toolCalls: [
              {
                id: "tool-1",
                tool: "long_task",
                args: {}
              }
            ]
          }
        }
      ],
      []
    );

    const controller = new AbortController();
    const runPromise = agent()
      .model("gpt-5")
      .use({
        name: "long-tool",
        tools: [
          {
            name: "long_task",
            async call(_args, ctx) {
              capturedSignal = ctx.signal;
              started.resolve();

              await new Promise<never>((_, reject) => {
                if (ctx.signal.aborted) {
                  reject(new Error("tool aborted"));
                  return;
                }

                ctx.signal.addEventListener(
                  "abort",
                  () => {
                    reject(new Error("tool aborted"));
                  },
                  { once: true }
                );
              });
            }
          }
        ],
        dispose
      })
      .run("Long task", {
        acpModel: model,
        signal: controller.signal
      });

    await started.promise;
    controller.abort(new Error("stop"));

    await expect(runPromise).rejects.toMatchObject({
      name: "AbortError",
      message: expect.stringMatching(/abort/i)
    });

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cascades external abort to child forks started from tools", async () => {
    const dispose = vi.fn(async () => undefined);
    const childStarted = createDeferred();
    const childAborted = createDeferred();
    let childSignal: AbortSignal | undefined;
    let modelCallCount = 0;

    const model: AcpModel = {
      complete: vi.fn(async ({ signal }) => {
        modelCallCount += 1;

        if (modelCallCount === 1) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-fork-1",
                  tool: "run_fork",
                  args: {}
                }
              ]
            }
          });
        }

        if (modelCallCount === 2) {
          childSignal = signal;
          childStarted.resolve();

          if (!signal.aborted) {
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  childAborted.resolve();
                  resolve();
                },
                { once: true }
              );
            });
          } else {
            childAborted.resolve();
          }

          throw new Error("child aborted");
        }

        throw new Error("Unexpected model call");
      })
    };

    const controller = new AbortController();
    const runPromise = agent()
      .model("gpt-5")
      .use({
        name: "fork-tool",
        tools: [
          {
            name: "run_fork",
            async call(_args, ctx) {
              await ctx.fork("child task");
              return "done";
            }
          }
        ],
        dispose
      })
      .run("Long task", {
        acpModel: model,
        signal: controller.signal
      });

    await childStarted.promise;
    controller.abort(new Error("stop"));

    await expect(runPromise).rejects.toMatchObject({
      name: "AbortError",
      message: expect.stringMatching(/abort/i)
    });
    await childAborted.promise;

    expect(childSignal).toBeDefined();
    expect(childSignal?.aborted).toBe(true);
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("uses one max-iterations abort path when plugin and run option are both configured", async () => {
    let callCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        callCount += 1;

        return toAcpModelResponse({
          message: {
            content: "",
            toolCalls: [
              {
                id: `tool-${callCount}`,
                tool: "always_call_tool",
                args: { iteration: callCount }
              }
            ]
          }
        });
      })
    };

    const events = await collectEvents(
      agent()
        .model("gpt-5")
        .use(maxIterationsPlugin(5))
        .use({
          name: "always-call-tool",
          tools: [
            {
              name: "always_call_tool",
              async call() {
                return "ok";
              }
            }
          ]
        })
        .stream("Always call a tool", {
          acpModel: model,
          maxIterations: 2
        })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "tool.intent",
      "tool.result",
      "session.error"
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("Maximum tool call iterations reached");
    }
  });

  it("keeps the run-level max-iterations safety net when another plugin reuses the same name", async () => {
    let callCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        callCount += 1;

        if (callCount <= 3) {
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: `tool-${callCount}`,
                  tool: "always_call_tool",
                  args: { iteration: callCount }
                }
              ]
            }
          });
        }

        return toAcpModelResponse({
          message: {
            content: "done",
            toolCalls: []
          }
        });
      })
    };

    const events = await collectEvents(
      agent()
        .model("gpt-5")
        .use({
          name: "max-iterations",
          hooks: {
            preIteration() {}
          }
        })
        .use({
          name: "always-call-tool",
          tools: [
            {
              name: "always_call_tool",
              async call() {
                return "ok";
              }
            }
          ]
        })
        .stream("Always call a tool", {
          acpModel: model,
          maxIterations: 2
        })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "tool.intent",
      "tool.result",
      "session.error"
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("Maximum tool call iterations reached");
    }
  });

  it("resumes only when requested and keeps runs isolated", async () => {
    const dispose = vi.fn(async () => undefined);
    let callCount = 0;

    const model: AcpModel = {
      complete: vi.fn(async (request) => {
        callCount += 1;
        const userMessages = request.messages.filter((message) => message.role === "user");
        const assistantMessages = request.messages.filter(
          (message) => message.role === "assistant"
        );

        if (callCount === 1) {
          expect(userMessages.map((message) => message.content)).toEqual(["Read the test file"]);
          expect(assistantMessages).toHaveLength(0);
          return toAcpModelResponse({
            message: {
              content: "first output",
              toolCalls: []
            }
          });
        }

        if (callCount === 2) {
          expect(userMessages.map((message) => message.content)).toEqual([
            "Read the test file",
            "Now fix the assertion"
          ]);
          expect(assistantMessages.map((message) => message.content)).toEqual(["first output"]);
          return toAcpModelResponse({
            message: {
              content: "second output",
              toolCalls: []
            }
          });
        }

        if (callCount === 3) {
          expect(userMessages.map((message) => message.content)).toEqual(["fresh run"]);
          expect(assistantMessages).toHaveLength(0);
          return toAcpModelResponse({
            message: {
              content: "third output",
              toolCalls: []
            }
          });
        }

        throw new Error("Unexpected model call");
      })
    };

    const configured = agent().model("gpt-5").use({
      name: "resourceful",
      dispose
    });

    const firstRun = await configured.run("Read the test file", {
      acpModel: model
    });
    await configured.run("Now fix the assertion", {
      acpModel: model,
      resume: firstRun
    });
    await configured.run("fresh run", {
      acpModel: model
    });

    expect(model.complete).toHaveBeenCalledTimes(3);
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it("activates skill tools from RunOptions.skills", async () => {
    const withSkillModel = {
      complete: vi.fn(async (request) => {
        expect(request.tools.map((tool) => tool.name)).toEqual(["always-visible", "repo_search"]);
        return toAcpModelResponse({
          message: {
            content: "done",
            toolCalls: []
          }
        });
      })
    } satisfies AcpModel;

    const withoutSkillModel = {
      complete: vi.fn(async (request) => {
        expect(request.tools.map((tool) => tool.name)).toEqual(["always-visible"]);
        return toAcpModelResponse({
          message: {
            content: "done",
            toolCalls: []
          }
        });
      })
    } satisfies AcpModel;

    const configured = agent()
      .model("gpt-5")
      .use({
        name: "skill-tools",
        tools: [
          { name: "always-visible", call: () => "ok" },
          { name: "repo_search", visibility: "skill", call: () => "ok" }
        ]
      });

    await configured.run("hello", { acpModel: withoutSkillModel });
    await configured.run("hello", { acpModel: withSkillModel, skills: ["repo_search"] });
  });

  it("disposes plugin resources when run fails", async () => {
    const dispose = vi.fn(async () => undefined);

    await expect(
      agent()
        .model("gpt-5")
        .use({
          name: "resourceful",
          dispose
        })
        .run("hello", {
          acpModel: createModel([new Error("model boom")], [])
        })
    ).rejects.toThrow("model boom");

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("emits session.error when stream preparation fails", async () => {
    const events = await collectEvents(
      agent()
        .model("gpt-5")
        .use({
          name: "needs-alpha",
          dependencies: ["alpha"]
        })
        .stream("hello", {
          acpModel: createModel(
            [
              {
                message: {
                  content: "done",
                  toolCalls: []
                }
              }
            ],
            []
          )
        })
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");

    if (events[0]?.type === "session.error") {
      expect(events[0].error.message).toContain(
        'Unknown plugin dependency "alpha" for plugin "needs-alpha".'
      );
    }
  });
});

// === system-prompt.test.ts ===

describe("poe-agent system prompt", () => {
  it("returns the bundled prompt asynchronously", async () => {
    const prompt = await loadSystemPrompt();

    expect(prompt).toContain("You are a Poe agent, built by Poe");
    expect(prompt).toContain("Assist with defensive security only");
  });

  it("returns the bundled prompt synchronously", () => {
    const prompt = loadSystemPromptSync();

    expect(prompt).toContain("You are a Poe agent, built by Poe");
    expect(prompt).toContain("Assist with defensive security only");
  });

  it("can import built system-prompt module in plain node", () => {
    const modulePath = path.resolve(process.cwd(), "packages/poe-agent/dist/system-prompt.js");
    const moduleUrl = pathToFileURL(modulePath).href;
    const command = `await import(${JSON.stringify(moduleUrl)});`;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", command], {
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
