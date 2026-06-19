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
    yolo: ["--dangerously-bypass-approvals-and-sandbox"],
    // `codex exec` cannot service command/file-change approval requests, so a
    // gaslight-style unattended edit mode must use the native bypass flag.
    auto: ["--dangerously-bypass-approvals-and-sandbox"],
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
    commandOptionsPosition: "beforeResume",
    hintArgs: (threadId, cwd) => ["resume", "-C", cwd, threadId]
  }
};
