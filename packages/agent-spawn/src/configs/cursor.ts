import type { CliSpawnConfig } from "../types.js";
import { toJsonMcpServers } from "./mcp.js";

export const cursorSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "cursor",
  adapter: "cursor",
  promptFlag: "-p",
  modelFlag: "--model",
  modelStripProviderPrefix: true,
  modelTransform: (model) =>
    model.startsWith("claude-opus-") ||
    model.startsWith("claude-sonnet-") ||
    model.startsWith("claude-haiku-")
      ? model.replaceAll(".", "-")
      : model,
  defaultArgs: ["--output-format", "stream-json", "--trust", "--approve-mcps"],
  defaultArgsPosition: "beforePrompt",
  modes: {
    yolo: ["--force", "--sandbox", "disabled"],
    edit: ["--force"],
    read: ["--mode", "plan"]
  },
  stdinMode: { omitPrompt: true, extraArgs: [] },
  mcpFile: {
    relativePath: ".cursor/mcp.json",
    content: (servers) => ({ mcpServers: toJsonMcpServers(servers) })
  },
  interactive: { defaultArgs: [] },
  resume: {
    args: (threadId) => ["--resume", threadId],
    position: "beforePrompt"
  }
};
