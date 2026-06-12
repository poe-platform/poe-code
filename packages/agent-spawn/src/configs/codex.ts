import type { CliSpawnConfig } from "../types.js";
import { serializeCodexMcpArgs } from "./mcp.js";

export const codexSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "codex",
  // ACP adapter support: yes (adapter: "codex")
  adapter: "codex",
  promptFlag: "exec",
  modelFlag: "--model",
  modelStripProviderPrefix: true,
  defaultArgs: ["--skip-git-repo-check", "--json"],
  mcpArgs: serializeCodexMcpArgs,
  mcpArgsBeforeCommand: true,
  modes: {
    // No auto: `codex exec` has no approval channel in headless runs.
    yolo: ["-s", "danger-full-access"],
    edit: ["-s", "workspace-write"],
    read: ["-s", "read-only"]
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["-"]
  },
  interactive: {
    defaultArgs: ["-a", "never"]
  },
  resume: {
    args: (threadId) => ["resume", threadId],
    position: "beforePrompt",
    hintArgs: (threadId, cwd) => ["resume", "-C", cwd, threadId]
  }
};
