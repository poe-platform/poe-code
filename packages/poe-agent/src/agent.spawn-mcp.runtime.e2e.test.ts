import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, defineSchema, type Server } from "tiny-stdio-mcp-server";
import { createInMemoryTransportPair, type McpTransport } from "tiny-mcp-client";
import { agent } from "./agent.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import spawnPlugin from "./plugins/poe-agent-plugin-spawn.js";
import { createInMemorySpawnSession } from "./runtime/agent-host.js";
import type { AgentPlugin } from "./runtime/plugin-types.js";
import type { AcpModel, AcpModelRequestMessage, AcpModelResponse } from "./runtime/acp-core.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "./testing/model-response.js";

type RuntimeFileSystem = {
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
  writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
};

type ModelCall = {
  messages: AcpModelRequestMessage[];
  tools: string[];
};

type StdioTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

const transportFactoryMock = vi.hoisted(() =>
  vi.fn<(options: StdioTransportOptions) => McpTransport>()
);

vi.mock("tiny-mcp-client", async () => {
  const actual = await vi.importActual<typeof import("tiny-mcp-client")>("tiny-mcp-client");

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
    }
  };
});

function createMockModel(
  responses: Array<LegacyAcpModelResponse | AcpModelResponse | Error>,
  onCall?: (call: ModelCall, callNumber: number) => void
): AcpModel {
  const queue = [...responses];
  let callNumber = 0;

  return {
    complete: vi.fn(async (request) => {
      callNumber += 1;
      onCall?.(
        {
          messages: request.messages,
          tools: request.tools.map((tool) => tool.name)
        },
        callNumber
      );

      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected model call #${callNumber}`);
      }

      if (next instanceof Error) {
        throw next;
      }

      return toAcpModelResponse(next);
    })
  };
}

function createRuntimeFs(files: Record<string, string>): RuntimeFileSystem {
  const volume = Volume.fromJSON(files, "/");
  const memfs = createFsFromVolume(volume).promises;

  return {
    async mkdir(targetPath, options) {
      await memfs.mkdir(targetPath, options);
    },
    async readFile(targetPath, encoding) {
      const content = await memfs.readFile(targetPath, encoding);
      return typeof content === "string" ? content : String(content);
    },
    async readdir(targetPath) {
      return (await memfs.readdir(targetPath)) as string[];
    },
    async writeFile(targetPath, data, encoding) {
      await memfs.writeFile(targetPath, data, encoding);
    }
  };
}

function testMcpServer(options: {
  command: string;
  serverName: string;
  visibility?: "model" | "skill";
}): AgentPlugin {
  return {
    name: "test-mcp-server-plugin",
    setup(api) {
      api.addMcp({
        name: options.serverName,
        command: options.command,
        visibility: options.visibility
      });
    }
  };
}

describe("runtime spawn + MCP plugin e2e", () => {
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
      transport.dispose(new Error("runtime spawn+mcp e2e cleanup"));
    }

    await Promise.allSettled(serverConnections);
  });

  it("spawn tool runs a fresh child, returns result, and parent continues", async () => {
    const modelCalls: ModelCall[] = [];
    const runtimeFs = createRuntimeFs({});
    const childPrompts: string[] = [];
    const childSessionOptions: Array<Record<string, unknown>> = [];
    const disposeChildSession = vi.fn(async () => undefined);

    const result = await agent()
      .model("test-model")
      .use(spawnPlugin())
      .use(
        filesPlugin({
          cwd: "/workspace",
          allowedPaths: ["/workspace"],
          fs: runtimeFs
        })
      )
      .run("Investigate the regression", {
        acpModel: createMockModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "spawn-1",
                    tool: "spawn",
                    args: { task: "Inspect suspected flaky test" }
                  }
                ]
              }
            },
            {
              message: {
                content: "Parent finished after child report",
                toolCalls: []
              }
            }
          ],
          (call) => {
            modelCalls.push(call);
          }
        ),
        createSpawnSession: () =>
          createInMemorySpawnSession({
            model: "test-model",
            cwd: "/workspace",
            createSession: async (options) => {
              childSessionOptions.push(options as Record<string, unknown>);
              return {
                async sendMessage(prompt: string) {
                  childPrompts.push(prompt);
                  return {
                    role: "assistant",
                    content: `child-result:${prompt}`
                  };
                },
                dispose: disposeChildSession
              };
            }
          })
      });

    expect(modelCalls).toHaveLength(2);
    expect(childPrompts).toEqual(["Inspect suspected flaky test"]);
    expect(childSessionOptions).toEqual([
      {
        model: "test-model",
        cwd: "/workspace"
      }
    ]);

    const secondCallMessages = modelCalls[1]?.messages ?? [];
    const spawnToolMessage = secondCallMessages.find(
      (message) =>
        message.role === "tool" && message.name === "spawn" && message.tool_call_id === "spawn-1"
    );
    expect(spawnToolMessage).toBeDefined();
    expect(spawnToolMessage?.content).toBe("child-result:Inspect suspected flaky test");

    expect(result.output).toBe("Parent finished after child report");
    expect(result.toolCalls).toEqual([
      {
        intentId: "spawn-1",
        tool: "spawn",
        args: { task: "Inspect suspected flaky test" },
        status: "success",
        result: "child-result:Inspect suspected flaky test"
      }
    ]);
    expect(disposeChildSession).toHaveBeenCalledTimes(1);
  });

  it("does not abort an in-flight spawned child when parent run is aborted", async () => {
    const runtimeFs = createRuntimeFs({});
    const controller = new AbortController();
    let releaseChild: (() => void) | undefined;
    let resolveChildCompleted: (() => void) | undefined;
    const childCompleted = new Promise<void>((resolve) => {
      resolveChildCompleted = resolve;
    });
    const disposeChildSession = vi.fn(async () => undefined);

    const runPromise = agent()
      .model("test-model")
      .use(spawnPlugin())
      .use(
        filesPlugin({
          cwd: "/workspace",
          allowedPaths: ["/workspace"],
          fs: runtimeFs
        })
      )
      .run("Investigate the regression", {
        signal: controller.signal,
        acpModel: createMockModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "spawn-1",
                  tool: "spawn",
                  args: { task: "Long child task" }
                }
              ]
            }
          }
        ]),
        createSpawnSession: () =>
          createInMemorySpawnSession({
            model: "test-model",
            cwd: "/workspace",
            createSession: async () => ({
              async sendMessage() {
                await new Promise<void>((resolve) => {
                  releaseChild = resolve;
                });
                resolveChildCompleted?.();
                return {
                  role: "assistant",
                  content: "child-finished"
                };
              },
              dispose: disposeChildSession
            })
          })
      });

    await vi.waitFor(() => {
      expect(releaseChild).toBeTypeOf("function");
    });

    controller.abort(new Error("stop parent"));

    await expect(runPromise).rejects.toMatchObject({
      name: "AbortError"
    });

    expect(disposeChildSession).not.toHaveBeenCalled();
    releaseChild?.();
    await childCompleted;

    await vi.waitFor(() => {
      expect(disposeChildSession).toHaveBeenCalledTimes(1);
    });
  });

  it("discovers MCP tools in setup, uses namespaced names, and disposes MCP client", async () => {
    const discoveredTools: string[][] = [];
    let transportClosed = false;
    const repoSearchToolName = ["repo", "search"].join("_");

    const searchSchema = defineSchema({
      query: { type: "string", description: "Search query" }
    });

    const server = createServer({ name: "repo-tools", version: "1.0.0" }).tool(
      "search",
      "Search repository",
      searchSchema,
      async (args) => `mcp-found:${args.query}`
    );

    commandToServer.set("repo-mcp", server);

    const result = await agent()
      .model("test-model")
      .use(
        testMcpServer({
          command: "repo-mcp",
          serverName: "repo"
        })
      )
      .run("Use the tools", {
        acpModel: createMockModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "mcp-1",
                    tool: repoSearchToolName,
                    args: { query: "regression" }
                  }
                ]
              }
            },
            {
              message: {
                content: "Done with MCP",
                toolCalls: []
              }
            }
          ],
          (call, callNumber) => {
            if (callNumber === 1) {
              const [transport] = clientTransports;
              expect(transport).toBeDefined();
              void transport?.closed.then(() => {
                transportClosed = true;
              });
            }
            if (callNumber === 2) {
              expect(transportClosed).toBe(false);
            }
            discoveredTools.push(call.tools);
          }
        )
      });

    expect(discoveredTools).toHaveLength(2);
    expect(discoveredTools[0]).toEqual([repoSearchToolName]);
    expect(discoveredTools[1]).toEqual([repoSearchToolName]);

    expect(result.toolCalls).toEqual([
      {
        intentId: "mcp-1",
        tool: repoSearchToolName,
        args: { query: "regression" },
        status: "success",
        result: "mcp-found:regression"
      }
    ]);
    expect(result.output).toBe("Done with MCP");

    expect(transportFactoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "repo-mcp"
      })
    );

    expect(clientTransports).toHaveLength(1);
    await Promise.all(
      clientTransports.map(async (transport) => {
        await transport.closed;
      })
    );
    expect(transportClosed).toBe(true);
  });
});
