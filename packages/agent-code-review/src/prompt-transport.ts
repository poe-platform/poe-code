import { getSpawnConfig } from "@poe-code/agent-spawn";

export function shouldUseTextStdinForCodeReview(agent: string): boolean {
  const config = getSpawnConfig(agent);
  return config?.kind === "cli" && (config.agentId === "codex" || config.agentId === "claude-code");
}
