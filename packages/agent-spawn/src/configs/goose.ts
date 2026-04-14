import type { AcpSpawnConfig, CliSpawnConfig } from "../types.js";
import { serializeGooseMcpArgs } from "./mcp.js";

export const gooseSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "goose",
  adapter: "native",
  promptFlag: "--text",
  modelFlag: "--model",
  modelStripProviderPrefix: false,
  defaultArgs: ["run", "--output-format", "stream-json"],
  defaultArgsPosition: "beforePrompt",
  mcpArgs: serializeGooseMcpArgs,
  mcpArgsPosition: "beforePrompt",
  modes: {
    yolo: { env: { GOOSE_MODE: "auto" } },
    edit: { env: { GOOSE_MODE: "smart_approve" } },
    read: { env: { GOOSE_MODE: "chat" } }
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["--instructions", "-"]
  },
  interactive: {
    defaultArgs: ["session"],
    defaultArgsPosition: "beforePrompt"
  },
  resumeCommand: () => ["run", "--resume", "--text", "continue"]
};

export const gooseAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "goose",
  acpArgs: ["acp"],
  skipAuth: true
};
