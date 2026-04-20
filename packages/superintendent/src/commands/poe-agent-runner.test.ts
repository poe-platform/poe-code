import { describe, expect, it, vi } from "vitest";
import type {
  AcpEvent,
  AgentBuilder,
  AgentPlugin,
  AgentRunOptions,
  RunResult
} from "@poe-code/poe-agent";
import type { McpSpawnConfig } from "@poe-code/agent-spawn";
import { executePoeAgent, type AgentFactory, type PoeMcpServerConfig } from "./poe-agent-runner.js";

type Capture = {
  modelCalls: string[];
  mcpCalls: PoeMcpServerConfig[][];
  pluginNames: string[];
  streamCalls: Array<{ prompt: string; options?: AgentRunOptions }>;
};

function createFakeFactory(events: AcpEvent[]): { factory: AgentFactory; capture: Capture } {
  const capture: Capture = {
    modelCalls: [],
    mcpCalls: [],
    pluginNames: [],
    streamCalls: []
  };

  const builder: AgentBuilder = {
    model(value: string) {
      capture.modelCalls.push(value);
      return builder;
    },
    use(plugin: AgentPlugin) {
      capture.pluginNames.push(plugin.name);
      return builder;
    },
    mcp(...configs: PoeMcpServerConfig[]) {
      capture.mcpCalls.push(configs);
      return builder;
    },
    async acp() {
      throw new Error("acp not used in tests");
    },
    async run(): Promise<RunResult> {
      throw new Error("run not used in tests");
    },
    async *stream(prompt: string, options?: AgentRunOptions) {
      capture.streamCalls.push({ prompt, ...(options ? { options } : {}) });
      for (const event of events) {
        yield event;
      }
    }
  };

  return { factory: () => builder, capture };
}

const completeEvent = (output: string): AcpEvent => ({
  type: "session.complete",
  result: { output, messages: [], toolCalls: [] }
});

describe("executePoeAgent", () => {
  it("parses model from agent specifier and passes it to .model()", async () => {
    const { factory, capture } = createFakeFactory([completeEvent("ok")]);

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(capture.modelCalls).toEqual(["openai/gpt-5.4"]);
  });

  it("converts McpSpawnConfig dict into McpServerConfig array with names", async () => {
    const { factory, capture } = createFakeFactory([completeEvent("ok")]);
    const mcpServers: McpSpawnConfig = {
      alpha: { command: "node", args: ["a.js"] },
      beta: { command: "python", env: { X: "1" } }
    };

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp", mcpServers },
      factory
    );

    expect(capture.mcpCalls).toHaveLength(1);
    const [configs] = capture.mcpCalls;
    expect(configs).toEqual([
      { name: "alpha", command: "node", args: ["a.js"] },
      { name: "beta", command: "python", env: { X: "1" } }
    ]);
  });

  it("forwards cwd and signal to stream options", async () => {
    const { factory, capture } = createFakeFactory([completeEvent("ok")]);
    const controller = new AbortController();

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      {
        agent: "poe-agent:openai/gpt-5.4",
        prompt: "hi",
        cwd: "/repo",
        signal: controller.signal
      },
      factory
    );

    expect(capture.streamCalls[0]?.prompt).toBe("hi");
    expect(capture.streamCalls[0]?.options?.cwd).toBe("/repo");
    expect(capture.streamCalls[0]?.options?.signal).toBe(controller.signal);
  });

  it("returns output from session.complete with exitCode 0", async () => {
    const { factory } = createFakeFactory([completeEvent("builder summary")]);

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("builder summary");
    expect(result.summary).toBe("builder summary");
    expect(result.stderr).toBe("");
  });

  it("captures usage from usage events", async () => {
    const { factory } = createFakeFactory([
      {
        type: "usage",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          cacheCreationTokens: 0
        }
      },
      completeEvent("ok")
    ]);

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 20
    });
  });

  it("streams message.delta chunks via onStdout", async () => {
    const { factory } = createFakeFactory([
      { type: "message.delta", content: "hello " },
      { type: "message.delta", content: "world" },
      completeEvent("hello world")
    ]);
    const chunks: string[] = [];

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      {
        agent: "poe-agent:openai/gpt-5.4",
        prompt: "hi",
        cwd: "/tmp",
        onStdout: (chunk) => chunks.push(chunk)
      },
      factory
    );

    expect(chunks).toEqual(["hello ", "world"]);
  });

  it("returns non-zero exitCode and stderr on session.error", async () => {
    const { factory } = createFakeFactory([
      { type: "session.error", error: new Error("model timed out") }
    ]);

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("model timed out");
  });

  it("throws when agent specifier has no model", async () => {
    const { factory } = createFakeFactory([completeEvent("ok")]);

    await expect(
      executePoeAgent("poe-agent", { agent: "poe-agent", prompt: "hi", cwd: "/tmp" }, factory)
    ).rejects.toThrow(/model/);
  });

  it("wires the default agent plugin bundle (system prompt, environment, files, shell, web)", async () => {
    const { factory, capture } = createFakeFactory([completeEvent("ok")]);

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(capture.pluginNames).toEqual(
      expect.arrayContaining([
        "poe-agent-plugin-system-prompt",
        "poe-agent-plugin-environment",
        "poe-agent-plugin-files",
        "poe-agent-plugin-shell",
        "poe-agent-plugin-web",
        "poe-agent-plugin-compaction",
        "skills"
      ])
    );
  });

  it("adds policy plugin only when input.mode is set", async () => {
    const withMode = createFakeFactory([completeEvent("ok")]);
    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp", mode: "yolo" },
      withMode.factory
    );
    expect(withMode.capture.pluginNames).toContain("poe-agent-plugin-policy");

    const withoutMode = createFakeFactory([completeEvent("ok")]);
    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      withoutMode.factory
    );
    expect(withoutMode.capture.pluginNames).not.toContain("poe-agent-plugin-policy");
  });

  it("writes a JSONL transcript when logDir + logFileName are provided and returns logFile", async () => {
    const { factory } = createFakeFactory([
      { type: "message.delta", content: "thinking..." },
      {
        type: "tool.intent",
        intentId: "t1",
        tool: "read_file",
        args: { path: "/repo/a" }
      },
      { type: "tool.result", intentId: "t1", result: "file contents" },
      completeEvent("done")
    ]);
    const appendCalls: Array<{ path: string; contents: string }> = [];
    const mkdirCalls: string[] = [];
    const fakeFs = {
      async mkdir(dir: string) {
        mkdirCalls.push(dir);
      },
      async appendFile(filePath: string, contents: string) {
        appendCalls.push({ path: filePath, contents });
      }
    };

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      {
        agent: "poe-agent:openai/gpt-5.4",
        prompt: "hi",
        cwd: "/repo",
        logDir: "/logs/round-3",
        logFileName: "builder.jsonl"
      },
      factory,
      fakeFs
    );

    expect(mkdirCalls).toEqual(["/logs/round-3"]);
    expect(appendCalls.map((c) => c.path)).toEqual([
      "/logs/round-3/builder.jsonl",
      "/logs/round-3/builder.jsonl",
      "/logs/round-3/builder.jsonl"
    ]);
    const sessionUpdates = appendCalls
      .flatMap((c) => c.contents.trim().split("\n"))
      .map((line) => JSON.parse(line));
    expect(sessionUpdates.map((u: { sessionUpdate: string }) => u.sessionUpdate)).toEqual([
      "agent_message_chunk",
      "tool_call",
      "tool_call_update",
      "tool_call_update"
    ]);
    expect(result.logFile).toBe("/logs/round-3/builder.jsonl");
  });

  it("does not open a transcript writer when logDir/logFileName are omitted", async () => {
    const { factory } = createFakeFactory([completeEvent("ok")]);
    const fakeFs = {
      mkdir: vi.fn(async () => undefined),
      appendFile: vi.fn(async () => undefined)
    };

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory,
      fakeFs
    );

    expect(fakeFs.mkdir).not.toHaveBeenCalled();
    expect(fakeFs.appendFile).not.toHaveBeenCalled();
    expect(result.logFile).toBeUndefined();
  });
});
