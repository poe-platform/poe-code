import type { CliSpawnConfig } from "../types.js";

export const claudeCodeSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "claude-code",
  // ACP adapter support: yes (adapter: "claude")
  adapter: "claude",
  promptFlag: "-p",
  modelFlag: "--model",
  defaultArgs: [
    "--output-format",
    "stream-json",
    "--verbose"
  ],
  modes: {
    yolo: ["--dangerously-skip-permissions"],
    edit: ["--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep,NotebookEdit"],
    read: ["--permission-mode", "plan"]
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["--input-format", "text"]
  },
  interactive: {
    defaultArgs: []
  },
  resumeCommand: (threadId) => ["--resume", threadId]
};
