import { parseAgentSpecifier } from "@poe-code/agent-defs";
import {
  agent as defaultAgent,
  compactionPlugin,
  environmentPlugin,
  filesPlugin,
  openaiChatCompletionsPlugin,
  openaiResponsesPlugin,
  policyPlugin,
  shellPlugin,
  skillsPlugin,
  systemPromptPlugin,
  webPlugin,
  type AgentBuilder,
  type RunResult
} from "@poe-code/poe-agent";
import type { SpawnMode } from "@poe-code/agent-spawn";
import type { AgentRunInput } from "../runtime/loop.js";

export type AgentFactory = () => AgentBuilder;

export type ExecutePoeAgentResult = RunResult;

export async function executePoeAgent(
  agentSpec: string,
  input: AgentRunInput,
  createAgent: AgentFactory = defaultAgent
): Promise<ExecutePoeAgentResult> {
  const { model } = parseAgentSpecifier(agentSpec);
  if (!model) {
    throw new Error(
      `poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4"); got "${agentSpec}".`
    );
  }

  return createAgent()
    .model(model)
    .use(openaiResponsesPlugin())
    .use(openaiChatCompletionsPlugin())
    .use(systemPromptPlugin())
    .use(environmentPlugin(input.cwd))
    .use(filesPlugin({ cwd: input.cwd }))
    .use(shellPlugin({ cwd: input.cwd }))
    .use(webPlugin())
    .use(compactionPlugin())
    .use(skillsPlugin({ definitions: {} }))
    .use(policyPlugin({ mode: input.mode as SpawnMode | undefined }))
    .mcp(input.mcpServers ?? {})
    .run(input.prompt, {
      cwd: input.cwd,
      signal: input.signal,
      onStdout: input.onStdout,
      logPath: input.logPath
    });
}
