import { mkdir, appendFile } from "node:fs/promises";
import { parseAgentSpecifier } from "@poe-code/agent-defs";
import {
  agent as defaultAgent,
  compactionPlugin,
  environmentPlugin,
  filesPlugin,
  policyPlugin,
  shellPlugin,
  skillsPlugin,
  systemPromptPlugin,
  webPlugin
} from "@poe-code/poe-agent";
import type { AgentBuilder } from "@poe-code/poe-agent";
import type { McpSpawnConfig, McpSpawnServer, SpawnMode } from "@poe-code/agent-spawn";
import type { AgentRunInput, AgentRunResult } from "../runtime/loop.js";
import {
  createTranscriptWriter,
  type TranscriptFsApi,
  type TranscriptWriter
} from "./poe-agent-transcript.js";

export type AgentFactory = () => AgentBuilder;

export type PoeMcpServerConfig = McpSpawnServer & { name: string };

export type ExecutePoeAgentResult = AgentRunResult & {
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
};

const defaultTranscriptFs: TranscriptFsApi = {
  mkdir: (dir, options) => mkdir(dir, options).then(() => undefined),
  appendFile: (filePath, contents) => appendFile(filePath, contents, "utf8")
};

export async function executePoeAgent(
  agentSpec: string,
  input: AgentRunInput,
  createAgent: AgentFactory = defaultAgent,
  transcriptFs: TranscriptFsApi = defaultTranscriptFs
): Promise<ExecutePoeAgentResult> {
  const { model } = parseAgentSpecifier(agentSpec);
  if (!model) {
    throw new Error(
      `poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4"); got "${agentSpec}".`
    );
  }

  const mcpConfigs = toPoeMcpConfigs(input.mcpServers);
  let builder = createAgent()
    .model(model)
    .use(systemPromptPlugin())
    .use(environmentPlugin(input.cwd))
    .use(filesPlugin({ cwd: input.cwd }))
    .use(shellPlugin({ cwd: input.cwd }))
    .use(webPlugin())
    .use(compactionPlugin())
    .use(skillsPlugin({ definitions: {} }));
  if (input.mode) {
    builder = builder.use(policyPlugin({ mode: input.mode as SpawnMode }));
  }
  builder = builder.mcp(...mcpConfigs);

  const streamOptions = {
    cwd: input.cwd,
    ...(input.signal ? { signal: input.signal } : {})
  };

  const transcript: TranscriptWriter | undefined =
    input.logDir && input.logFileName
      ? createTranscriptWriter({
          logDir: input.logDir,
          logFileName: input.logFileName,
          fs: transcriptFs
        })
      : undefined;

  let completed = "";
  let streamed = "";
  let failure: Error | undefined;
  let usage: ExecutePoeAgentResult["usage"] | undefined;
  const toolCalls: Array<{ title: string; input: unknown }> = [];

  try {
    for await (const event of builder.stream(input.prompt, streamOptions)) {
      if (transcript) {
        await transcript.write(event);
      }
      if (event.type === "message.delta") {
        input.onStdout?.(event.content);
        streamed += event.content;
      } else if (event.type === "tool.intent") {
        toolCalls.push({ title: event.tool, input: event.args });
      } else if (event.type === "usage") {
        usage = {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cachedTokens: event.usage.cachedTokens
        };
      } else if (event.type === "session.complete") {
        completed = event.result.output;
      } else if (event.type === "session.error") {
        failure = event.error;
      }
    }
  } finally {
    await transcript?.close();
  }

  if (failure) {
    return {
      stdout: streamed,
      stderr: failure.message,
      exitCode: 1,
      ...(transcript ? { logFile: transcript.filePath } : {}),
      ...(usage ? { usage } : {})
    };
  }

  const output = completed || streamed;
  return {
    stdout: output,
    stderr: "",
    exitCode: 0,
    summary: output,
    ...(transcript ? { logFile: transcript.filePath } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(usage ? { usage } : {})
  };
}

function toPoeMcpConfigs(servers: McpSpawnConfig | undefined): PoeMcpServerConfig[] {
  if (!servers) {
    return [];
  }
  return Object.entries(servers).map(([name, server]) => ({ name, ...server }));
}
