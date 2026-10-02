import { runHostAgent } from "#superintendent-runner";
import type { RuntimeOverrideOptions } from "@poe-code/agent-harness-tools";
import type { McpSpawnConfig, SpawnMode } from "@poe-code/agent-spawn";
export { withAutonomousAgentRunner } from "#superintendent-runner";

export type { McpSpawnConfig, SpawnMode };

export type AutonomousInput = {
  runner?: AutonomousRunner;
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
  logPath?: string;
  signal?: AbortSignal;
  runtime?: RuntimeOverrideOptions["runtime"];
  runtimeImage?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RuntimeOverrideOptions["runnerSync"];
};

export type AutonomousOutput =
  | string
  | {
      summary?: unknown;
      log?: unknown;
      output?: unknown;
      stdout?: unknown;
      text?: unknown;
      toolCalls?: unknown;
      sessionResult?: unknown;
      logFile?: unknown;
    };

export type AutonomousRunner = (
  agent: string,
  options: Omit<AutonomousInput, "agent" | "runner">
) => Promise<AutonomousOutput>;

export async function runAutonomousAgent(input: AutonomousInput): Promise<AutonomousOutput> {
  const { runner, agent, ...options } = input;
  return runner ? runner(agent, options) : runHostAgent(input);
}
