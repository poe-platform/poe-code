import type { AcpSpawnConfig, CliSpawnConfig } from "../types.js";
import { serializeGooseMcpArgs } from "./mcp.js";

const gooseFileSecretsEnv = { GOOSE_DISABLE_KEYRING: "1" };

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
    // No auto: GOOSE_MODE=approve prompts on the TTY and would hang a headless run.
    yolo: { env: { ...gooseFileSecretsEnv, GOOSE_MODE: "auto" } },
    edit: { env: { ...gooseFileSecretsEnv, GOOSE_MODE: "smart_approve" } },
    read: { env: { ...gooseFileSecretsEnv, GOOSE_MODE: "chat" } }
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["--instructions", "-"],
    automaticFallback: false
  },
  interactive: {
    defaultArgs: ["session"],
    defaultArgsPosition: "beforePrompt"
  },
  resume: {
    args: (threadId) => ["--resume", "--session-id", threadId],
    hintArgs: (threadId) => ["run", "--resume", "--session-id", threadId, "--text", "continue"]
  }
};

export const gooseAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "goose",
  acpArgs: ["acp"],
  env: gooseFileSecretsEnv,
  skipAuth: true
};
