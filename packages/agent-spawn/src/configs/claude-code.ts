import type { CliSpawnConfig } from "../types.js";
import { serializeJsonMcpArgs } from "./mcp.js";

export const claudeCodeSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "claude-code",
  // ACP adapter support: yes (adapter: "claude")
  adapter: "claude",
  promptFlag: "-p",
  modelFlag: "--model",
  modelStripProviderPrefix: true,
  modelTransform: (model) => model.replaceAll(".", "-"),
  defaultArgs: [
    "--output-format",
    "stream-json",
    "--verbose"
  ],
  mcpArgs: serializeJsonMcpArgs,
  modes: {
    yolo: ["--dangerously-skip-permissions"],
    auto: ["--permission-mode", "auto"],
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
  resume: {
    args: (threadId) => ["--resume", threadId]
  }
};
