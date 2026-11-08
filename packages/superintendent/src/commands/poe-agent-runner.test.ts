import { describe, expect, it } from "vitest";
import type { AgentBuilder, AgentPlugin, AgentRunOptions, RunResult } from "@poe-code/poe-agent";
import type { McpSpawnConfig } from "@poe-code/agent-spawn";
import { executePoeAgent, type AgentFactory } from "./poe-agent-runner.js";

type Capture = {
  modelCalls: string[];
  mcpCalls: unknown[][];
  pluginNames: string[];
  runCalls: Array<{ prompt: string; options?: AgentRunOptions }>;
};

type RunHandler = (prompt: string, options?: AgentRunOptions) => Promise<RunResult> | RunResult;

function buildRunResult(overrides: Partial<RunResult> = {}): RunResult {
  const output = overrides.output ?? "ok";

  return {
    output,
    stdout: overrides.stdout ?? output,
    summary: overrides.summary ?? output,
    messages: overrides.messages ?? [],
    toolCalls: overrides.toolCalls ?? [],
    exitCode: overrides.exitCode ?? 0,
    stderr: overrides.stderr ?? "",
    ...(overrides.logFile ? { logFile: overrides.logFile } : {}),
    ...(overrides.usage ? { usage: overrides.usage } : {})
  };
}

function createFakeFactory(runHandler: RunHandler = () => buildRunResult()): {
  factory: AgentFactory;
  capture: Capture;
} {
  const capture: Capture = {
    modelCalls: [],
    mcpCalls: [],
    pluginNames: [],
    runCalls: []
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
    tools() {
      return builder;
    },
    mcp(...configs: unknown[]) {
      capture.mcpCalls.push(configs);
      return builder;
    },
    async acp() {
      throw new Error("acp not used in tests");
    },
    async run(prompt: string, options?: AgentRunOptions): Promise<RunResult> {
      capture.runCalls.push({ prompt, ...(options ? { options } : {}) });
      return await runHandler(prompt, options);
    },
    stream(): AsyncIterable<never> {
      throw new Error("stream not used in tests");
    }
  };

  return { factory: () => builder, capture };
}

describe("executePoeAgent", () => {
  it("parses model from agent specifier and passes it to .model()", async () => {
    const { factory, capture } = createFakeFactory();

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(capture.modelCalls).toEqual(["openai/gpt-5.4"]);
  });

  it("forwards McpSpawnConfig dict directly to .mcp()", async () => {
    const { factory, capture } = createFakeFactory();
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
    expect(capture.mcpCalls[0]).toEqual([mcpServers]);
  });

  it("forwards cwd, signal, onStdout, and logPath to .run()", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    const onStdout = (chunk: string) => chunks.push(chunk);
    const { factory, capture } = createFakeFactory(async (_prompt, options) => {
      options?.onStdout?.("hello ");
      options?.onStdout?.("world");

      return buildRunResult({
        output: "hello world",
        stdout: "hello world",
        summary: "hello world",
        logFile: "/logs/round-3/builder.jsonl"
      });
    });

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      {
        agent: "poe-agent:openai/gpt-5.4",
        prompt: "hi",
        cwd: "/repo",
        signal: controller.signal,
        logPath: "/logs/round-3/builder.jsonl",
        onStdout
      },
      factory
    );

    expect(capture.runCalls[0]?.prompt).toBe("hi");
    expect(capture.runCalls[0]?.options).toEqual({
      cwd: "/repo",
      signal: controller.signal,
      onStdout,
      logPath: "/logs/round-3/builder.jsonl"
    });
    expect(chunks).toEqual(["hello ", "world"]);
    expect(result.logFile).toBe("/logs/round-3/builder.jsonl");
  });

  it("returns the run result unchanged", async () => {
    const runResult = buildRunResult({
      output: "builder summary",
      stdout: "builder summary",
      summary: "builder summary",
      toolCalls: [
        {
          intentId: "tool-1",
          tool: "read_file",
          args: { path: "README.md" },
          status: "success",
          result: "# hi"
        }
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20,
        cacheCreationTokens: 0
      }
    });
    const { factory } = createFakeFactory(() => runResult);

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(result).toBe(runResult);
  });

  it("preserves non-zero exitCode and stderr from .run()", async () => {
    const runResult = buildRunResult({
      output: "working ",
      stdout: "working ",
      exitCode: 1,
      stderr: "model timed out"
    });
    const { factory } = createFakeFactory(() => runResult);

    const result = await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(result).toBe(runResult);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("model timed out");
  });

  it("throws when agent specifier has no model", async () => {
    const { factory } = createFakeFactory();

    await expect(
      executePoeAgent("poe-agent", { agent: "poe-agent", prompt: "hi", cwd: "/tmp" }, factory)
    ).rejects.toThrow(/model/);
  });

  it("wires the default plugin bundle including policy plugin", async () => {
    const { factory, capture } = createFakeFactory();

    await executePoeAgent(
      "poe-agent:openai/gpt-5.4",
      { agent: "poe-agent:openai/gpt-5.4", prompt: "hi", cwd: "/tmp" },
      factory
    );

    expect(capture.pluginNames).toEqual([
      "openai-responses-plugin",
      "openai-chat-completions-plugin",
      "poe-agent-plugin-system-prompt",
      "environment",
      "poe-agent-plugin-files",
      "poe-agent-plugin-shell",
      "poe-agent-plugin-web",
      "poe-agent-plugin-compaction",
      "skills",
      "poe-agent-plugin-policy"
    ]);
  });
});
