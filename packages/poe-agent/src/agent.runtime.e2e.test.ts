import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { agent } from "./agent.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import shellPlugin from "./plugins/poe-agent-plugin-shell.js";
import systemPromptPlugin from "./plugins/poe-agent-plugin-system-prompt.js";
import webPlugin from "./plugins/poe-agent-plugin-web.js";
import type { AcpModel, AcpModelRequestMessage, AcpModelResponse } from "./runtime/acp-core.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "./testing/model-response.js";
import type { AgentPlugin } from "./runtime/plugin-types.js";
import type { AcpEvent } from "./runtime/types.js";
import { loadSystemPromptSync } from "./system-prompt.js";

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
  const volume = new Volume();

  for (const [filePath, content] of Object.entries(files)) {
    volume.mkdirSync(path.dirname(filePath), { recursive: true });
    volume.writeFileSync(filePath, content, "utf8");
  }

  const memfs = createFsFromVolume(volume).promises;

  return {
    mkdir: async (targetPath, options) => {
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

async function* chunks(values: string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value;
  }
}

describe("runtime core e2e", () => {
  it("runs full lifecycle for basic run with setup/compile/tool/result/disposal", async () => {
    const workingDir = "/workspace";
    const filePath = "/workspace/test.txt";
    const fileContent = "runtime file content";
    const modelCalls: ModelCall[] = [];
    const lifecycleTrace: string[] = [];
    const baseSystemPrompt = "BASE SYSTEM PROMPT";

    const runtimeFs = createRuntimeFs({ [filePath]: fileContent });
    const readFileSpy = vi.fn(runtimeFs.readFile);
    const trackedFs: RuntimeFileSystem = {
      ...runtimeFs,
      readFile: async (targetPath, encoding) => {
        lifecycleTrace.push("host.execute.read_file");
        return await readFileSpy(targetPath, encoding);
      }
    };

    const shellRunSpy = vi.fn(async () => "shell-ok");
    const lifecyclePlugin: AgentPlugin = {
      name: "lifecycle-plugin",
      setup() {
        lifecycleTrace.push("plugin.setup");
      },
      prompt(ctx) {
        lifecycleTrace.push("prompt.compile");
        return ctx;
      },
      dispose() {
        lifecycleTrace.push("plugin.dispose");
      }
    };

    const result = await agent()
      .model("test-model")
      .use(systemPromptPlugin())
      .use(
        filesPlugin({
          cwd: workingDir,
          allowedPaths: [workingDir],
          fs: trackedFs
        })
      )
      .use(
        shellPlugin({
          cwd: workingDir,
          allowedPaths: [workingDir],
          runCommand: shellRunSpy
        })
      )
      .use(lifecyclePlugin)
      .run("Read the file at /tmp/test.txt", {
        baseSystemPrompt,
        acpModel: createMockModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "intent-read-1",
                    tool: "read_file",
                    args: { path: filePath }
                  }
                ]
              }
            },
            {
              message: {
                content: "file contents loaded",
                toolCalls: []
              }
            }
          ],
          (call, callNumber) => {
            lifecycleTrace.push(`model.call.${callNumber}`);
            modelCalls.push(call);
          }
        )
      });

    expect(modelCalls).toHaveLength(2);
    expect(modelCalls[0]?.tools).toEqual([
      "read_file",
      "edit_file",
      "list_files",
      "grep",
      "glob",
      "run_command",
      "read_background",
      "kill_background"
    ]);

    const firstMessages = modelCalls[0]?.messages ?? [];
    const systemMessage = firstMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain(loadSystemPromptSync());
    expect(systemMessage?.content).toContain(baseSystemPrompt);

    const secondMessages = modelCalls[1]?.messages ?? [];
    const assistantToolCallMessage = secondMessages.find(
      (message) =>
        message.role === "assistant" &&
        message.tool_calls?.some((toolCall) => toolCall.id === "intent-read-1")
    );
    expect(assistantToolCallMessage).toBeDefined();

    const toolInjectionMessage = secondMessages.find(
      (message) => message.role === "tool" && message.tool_call_id === "intent-read-1"
    );
    expect(toolInjectionMessage?.content).toBe(fileContent);

    expect(result.toolCalls).toEqual([
      {
        intentId: "intent-read-1",
        tool: "read_file",
        args: { path: filePath },
        status: "success",
        result: fileContent
      }
    ]);
    expect(result.output).toBe("file contents loaded");
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).toHaveBeenCalledWith(filePath, "utf8");
    expect(shellRunSpy).not.toHaveBeenCalled();

    expect(lifecycleTrace).toEqual([
      "plugin.setup",
      "prompt.compile",
      "model.call.1",
      "host.execute.read_file",
      "prompt.compile",
      "model.call.2",
      "plugin.dispose"
    ]);
  });

  it("handles tool failures end-to-end and still disposes plugins", async () => {
    const workingDir = "/workspace";
    const modelCalls: ModelCall[] = [];
    const lifecycleTrace: string[] = [];
    const shellError = new Error("shell exploded");

    const shellRunSpy = vi.fn(async () => {
      throw shellError;
    });

    const lifecyclePlugin: AgentPlugin = {
      name: "lifecycle-plugin-errors",
      setup() {
        lifecycleTrace.push("plugin.setup");
      },
      prompt(ctx) {
        lifecycleTrace.push("prompt.compile");
        return ctx;
      },
      dispose() {
        lifecycleTrace.push("plugin.dispose");
      }
    };

    const result = await agent()
      .model("test-model")
      .use(systemPromptPlugin())
      .use(
        shellPlugin({
          cwd: workingDir,
          allowedPaths: [workingDir],
          runCommand: shellRunSpy
        })
      )
      .use(lifecyclePlugin)
      .run("List files", {
        baseSystemPrompt: "base",
        acpModel: createMockModel(
          [
            {
              message: {
                content: "",
                toolCalls: [
                  {
                    id: "intent-shell-1",
                    tool: "run_command",
                    args: { command: "ls" }
                  }
                ]
              }
            },
            {
              message: {
                content: "Handled command failure.",
                toolCalls: []
              }
            }
          ],
          (call, callNumber) => {
            lifecycleTrace.push(`model.call.${callNumber}`);
            modelCalls.push(call);
          }
        )
      });

    expect(shellRunSpy).toHaveBeenCalledTimes(1);
    expect(modelCalls).toHaveLength(2);
    expect(result.output).toBe("Handled command failure.");
    expect(result.toolCalls).toEqual([
      {
        intentId: "intent-shell-1",
        tool: "run_command",
        args: { command: "ls" },
        status: "error",
        error: "shell exploded"
      }
    ]);

    const secondMessages = modelCalls[1]?.messages ?? [];
    const toolInjectionMessage = secondMessages.find(
      (message) => message.role === "tool" && message.tool_call_id === "intent-shell-1"
    );
    expect(toolInjectionMessage?.content).toBe("Error: shell exploded");

    expect(lifecycleTrace).toEqual([
      "plugin.setup",
      "prompt.compile",
      "model.call.1",
      "prompt.compile",
      "model.call.2",
      "plugin.dispose"
    ]);
  });

  it("keeps immutable builders isolated with no state leakage", async () => {
    const workingDir = "/workspace";
    const runtimeFs = createRuntimeFs({
      "/workspace/notes.txt": "notes"
    });

    const base = agent()
      .model("test-model")
      .use(systemPromptPlugin())
      .use(
        filesPlugin({
          cwd: workingDir,
          allowedPaths: [workingDir],
          fs: runtimeFs
        })
      );

    const researcher = base.use(
      webPlugin({
        searchWeb: vi.fn(async () => "search result")
      })
    );

    const writer = base.use(
      shellPlugin({
        cwd: workingDir,
        allowedPaths: [workingDir],
        runCommand: vi.fn(async () => "ok")
      })
    );

    async function runAndCaptureTools(builder: ReturnType<typeof agent>): Promise<string[]> {
      const calls: string[][] = [];

      await builder.run("ping", {
        acpModel: createMockModel(
          [
            {
              message: {
                content: "done",
                toolCalls: []
              }
            }
          ],
          (call) => {
            calls.push(call.tools);
          }
        ),
        baseSystemPrompt: "base"
      });

      return calls[0] ?? [];
    }

    const baseTools = await runAndCaptureTools(base);
    const researcherTools = await runAndCaptureTools(researcher);
    const writerTools = await runAndCaptureTools(writer);
    const researcherToolsAgain = await runAndCaptureTools(researcher);

    expect(baseTools).toEqual(["read_file", "edit_file", "list_files", "grep", "glob"]);

    expect(researcherTools).toEqual([
      "read_file",
      "edit_file",
      "list_files",
      "grep",
      "glob",
      "search_web",
      "fetch_url"
    ]);
    expect(researcherTools).not.toContain("run_command");

    expect(writerTools).toEqual([
      "read_file",
      "edit_file",
      "list_files",
      "grep",
      "glob",
      "run_command",
      "read_background",
      "kill_background"
    ]);
    expect(writerTools).not.toContain("search_web");

    expect(baseTools).not.toContain("search_web");
    expect(baseTools).not.toContain("run_command");
    expect(researcherToolsAgain).toEqual(researcherTools);
  });

  it("clones plugin definitions so post-use mutations do not leak", async () => {
    const mutablePlugin: AgentPlugin = {
      name: "mutable-tools",
      tools: [
        {
          name: "tools_initial",
          call: async () => "initial"
        }
      ]
    };
    const configured = agent().model("test-model").use(mutablePlugin);

    mutablePlugin.name = "mutated-name";
    mutablePlugin.tools?.push({
      name: "tools_leaked",
      call: async () => "leaked"
    });

    const calls: string[][] = [];

    await configured.run("ping", {
      acpModel: createMockModel(
        [
          {
            message: {
              content: "done",
              toolCalls: []
            }
          }
        ],
        (call) => {
          calls.push(call.tools);
        }
      ),
      baseSystemPrompt: "base"
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["tools_initial"]);
    expect(calls[0]).not.toContain("tools_leaked");
  });

  it("streams events in order with matched tool intent/result and terminal completion", async () => {
    const events: AcpEvent[] = [];

    const model = createMockModel([
      {
        message: {
          content: "",
          toolCalls: [
            { id: "intent-a", tool: "tools_alpha", args: { value: 1 } },
            { id: "intent-b", tool: "tools_beta", args: { value: 2 } }
          ]
        }
      },
      {
        deltas: chunks(["Final", " output"]),
        message: {
          content: "",
          toolCalls: []
        }
      }
    ]);

    for await (const event of agent()
      .model("test-model")
      .use({
        name: "tools",
        tools: [
          { name: "tools_alpha", call: async () => "alpha-result" },
          { name: "tools_beta", call: async () => "beta-result" }
        ]
      })
      .stream("Do something", { acpModel: model })) {
      events.push(event);
    }

    const deltas = events.filter((event) => event.type === "message.delta");
    const intents = events.filter((event) => event.type === "tool.intent");
    const results = events.filter((event) => event.type === "tool.result");
    const completions = events.filter((event) => event.type === "session.complete");

    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((event) => event.content).join("")).toBe("Final output");

    expect(intents).toHaveLength(2);
    expect(results).toHaveLength(2);

    const intentIds = new Set(intents.map((event) => event.intentId));
    const resultIds = new Set(results.map((event) => event.intentId));
    expect(resultIds).toEqual(intentIds);

    for (const id of intentIds) {
      const intentIndex = events.findIndex(
        (event) => event.type === "tool.intent" && event.intentId === id
      );
      const resultIndex = events.findIndex(
        (event) => event.type === "tool.result" && event.intentId === id
      );
      expect(intentIndex).toBeGreaterThanOrEqual(0);
      expect(resultIndex).toBeGreaterThan(intentIndex);
    }

    expect(completions).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe("session.complete");

    const completion = completions[0];
    if (completion?.type === "session.complete") {
      expect(completion.result.output).toBe("Final output");
    }
  });

  it("streams tool.intent/tool.error pairs with matching ids and one completion", async () => {
    const events: AcpEvent[] = [];

    const model = createMockModel([
      {
        message: {
          content: "",
          toolCalls: [{ id: "intent-fail", tool: "tools_fail", args: { input: "x" } }]
        }
      },
      {
        deltas: chunks(["Recovered"]),
        message: {
          content: "",
          toolCalls: []
        }
      }
    ]);

    for await (const event of agent()
      .model("test-model")
      .use({
        name: "tools",
        tools: [
          {
            name: "tools_fail",
            call: async () => {
              throw new Error("tool failed");
            }
          }
        ]
      })
      .stream("Do something", { acpModel: model })) {
      events.push(event);
    }

    const intents = events.filter((event) => event.type === "tool.intent");
    const errors = events.filter((event) => event.type === "tool.error");
    const results = events.filter((event) => event.type === "tool.result");
    const completions = events.filter((event) => event.type === "session.complete");
    const deltas = events.filter((event) => event.type === "message.delta");

    expect(intents).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(results).toHaveLength(0);
    expect(intents[0]?.intentId).toBe(errors[0]?.intentId);
    expect(errors[0]?.error).toBe("tool failed");
    expect(deltas.map((event) => event.content).join("")).toBe("Recovered");

    expect(completions).toHaveLength(1);
    expect(events[events.length - 1]?.type).toBe("session.complete");
    expect(events.some((event) => event.type === "session.error")).toBe(false);

    const completion = completions[0];
    if (completion?.type === "session.complete") {
      expect(completion.result.toolCalls).toEqual([
        {
          intentId: "intent-fail",
          tool: "tools_fail",
          args: { input: "x" },
          status: "error",
          error: "tool failed"
        }
      ]);
      expect(completion.result.output).toBe("Recovered");
    }
  });
});
