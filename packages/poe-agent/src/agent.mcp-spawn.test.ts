import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpModel, AcpModelResponse } from "./runtime/acp-core.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "./testing/model-response.js";

const createInMemorySpawnSessionMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(() => vi.fn(async () => undefined));
const mcpClientListToolsMock = vi.hoisted(() => vi.fn(async () => ({ tools: [] })));
const mcpClientCloseMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./runtime/agent-host.js", async () => {
  const actual =
    await vi.importActual<typeof import("./runtime/agent-host.js")>("./runtime/agent-host.js");

  return {
    ...actual,
    createInMemorySpawnSession: (...args: unknown[]) => createInMemorySpawnSessionMock(...args)
  };
});

vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {
    constructor() {}
  },
  McpClient: class {
    constructor() {}

    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }

    async listTools(): Promise<{ tools: Array<Record<string, unknown>> }> {
      return mcpClientListToolsMock();
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  }
}));

import { agent } from "./agent.js";
import policyPlugin from "./plugins/poe-agent-plugin-policy.js";
import spawnPlugin from "./plugins/poe-agent-plugin-spawn.js";

function createModel(
  responses: Array<LegacyAcpModelResponse | AcpModelResponse | Error>
): AcpModel {
  const queue = [...responses];

  return {
    complete: vi.fn(async () => {
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

describe("agent builder MCP spawn handoff", () => {
  beforeEach(() => {
    createInMemorySpawnSessionMock.mockReset();
    mcpClientConnectMock.mockClear();
    mcpClientListToolsMock.mockClear();
    mcpClientCloseMock.mockClear();
    createInMemorySpawnSessionMock.mockImplementation((options) => ({
      cwd: options.cwd,
      mcpServers: [],
      client: {
        initialize: vi.fn(async () => undefined),
        newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
        prompt: vi.fn(() => ({
          response: Promise.resolve({ stopReason: "completed" as const }),
          async *[Symbol.asyncIterator]() {
            yield {
              params: {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: "child-output"
                  }
                }
              }
            };
          }
        })),
        dispose: vi.fn(async () => undefined)
      }
    }));
  });

  it("passes builder MCP servers into the default spawn session factory", async () => {
    await agent()
      .model("test-model")
      .mcp({
        name: "repo",
        command: "repo-mcp",
        args: ["--stdio"],
        env: { TOKEN: "secret" }
      })
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Inspect MCP child config" }
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
        ])
      });

    expect(createInMemorySpawnSessionMock).toHaveBeenCalledWith({
      model: "test-model",
      cwd: "/workspace",
      mcpServers: {
        repo: {
          transport: "stdio",
          command: "repo-mcp",
          args: ["--stdio"],
          env: { TOKEN: "secret" }
        }
      }
    });
  });

  it("accepts map-based MCP config and passes it into the default spawn session factory", async () => {
    await agent()
      .model("test-model")
      .mcp({
        repo: {
          command: "repo-mcp",
          args: ["--stdio"],
          env: { TOKEN: "secret" },
          timeout: 45
        }
      })
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Inspect MCP child config" }
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
        ])
      });

    expect(createInMemorySpawnSessionMock).toHaveBeenCalledWith({
      model: "test-model",
      cwd: "/workspace",
      mcpServers: {
        repo: {
          transport: "stdio",
          command: "repo-mcp",
          args: ["--stdio"],
          env: { TOKEN: "secret" },
          timeout: 45
        }
      }
    });
  });

  it("preserves a map-based MCP server named __proto__ during spawn handoff", async () => {
    await agent()
      .model("test-model")
      .mcp(JSON.parse('{"__proto__":{"command":"custom-server"}}'))
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Inspect MCP child config" }
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
        ])
      });

    const options = createInMemorySpawnSessionMock.mock.calls[0]?.[0] as {
      mcpServers?: Record<string, unknown>;
    };
    expect(Object.hasOwn(options.mcpServers ?? {}, "__proto__")).toBe(true);
    expect(options.mcpServers?.["__proto__"]).toEqual({
      transport: "stdio",
      command: "custom-server"
    });
  });

  it("treats an empty map-based MCP config as no MCP servers during spawn handoff", async () => {
    await agent()
      .model("test-model")
      .mcp({})
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Inspect MCP child config" }
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
        ])
      });

    expect(createInMemorySpawnSessionMock).toHaveBeenCalledWith({
      model: "test-model",
      cwd: "/workspace"
    });
  });

  it("passes the active policy mode into the default spawn session factory", async () => {
    await agent()
      .model("test-model")
      .use(policyPlugin({ mode: "edit" }))
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Inspect child policy mode" }
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
        ])
      });

    expect(createInMemorySpawnSessionMock).toHaveBeenCalledWith({
      model: "test-model",
      cwd: "/workspace",
      mode: "edit"
    });
  });

  it("passes per-run environment overrides into the default spawn session factory", async () => {
    await agent()
      .model("test-model")
      .use(spawnPlugin())
      .run("Spawn a child", {
        cwd: "/workspace",
        env: { RUN_ONLY: "1", REMOVE_ME: undefined },
        acpModel: createModel([
          {
            message: {
              content: "",
              toolCalls: [{ id: "spawn-1", tool: "spawn", args: { task: "Inspect child env" } }]
            }
          },
          { message: { content: "done", toolCalls: [] } }
        ])
      });

    expect(createInMemorySpawnSessionMock).toHaveBeenCalledWith({
      model: "test-model",
      cwd: "/workspace",
      env: { RUN_ONLY: "1", REMOVE_ME: undefined }
    });
  });
});
