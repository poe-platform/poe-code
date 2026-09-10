import type { AcpSpawnConfig, CliSpawnConfig } from "../types.js";
import { serializeJsonMcpArgs } from "./mcp.js";

export const kimiSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "kimi",
  // ACP adapter support: yes (adapter: "kimi").
  // Kimi's `--output-format stream-json` emits OpenAI-style `{ role, content }` JSON
  // (no `{ event, ... }` field), so it needs the Kimi adapter (not "native").
  adapter: "kimi",
  promptFlag: "-p",
  modelFlag: "--model",
  // Kimi selects a local models-table alias, which may itself contain slashes.
  modelStripProviderPrefix: false,
  defaultArgs: ["--print", "--output-format", "stream-json"],
  mcpArgs: serializeJsonMcpArgs,
  modes: {
    // No auto: kimi --print mode has no approval channel.
    yolo: ["--yolo"],
    edit: [],
    read: []
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["--input-format", "stream-json"],
    automaticFallback: false
  },
  interactive: {
    defaultArgs: [],
    promptFlag: "-p"
  },
  resume: {
    args: (threadId, cwd) => ["--session", threadId, "--work-dir", cwd]
  }
};

export const kimiAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "kimi",
  acpArgs: ["acp"],
  supportsMcpServers: false,
};
