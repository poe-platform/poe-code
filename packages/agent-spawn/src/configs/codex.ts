import type { CliSpawnConfig } from "../types.js";

export const codexSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "codex",
  // ACP adapter support: yes (adapter: "codex")
  adapter: "codex",
  promptFlag: "exec",
  modelFlag: "--model",
  modelStripProviderPrefix: true,
  defaultArgs: ["--skip-git-repo-check", "--json"],
  modes: {
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
  resumeCommand: (threadId, cwd) => ["resume", "-C", cwd, threadId]
};
