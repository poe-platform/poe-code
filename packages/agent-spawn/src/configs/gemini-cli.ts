import type { AcpSpawnConfig } from "../types.js";

export const geminiCliAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "gemini-cli",
  acpArgs: ({ model, mcpServers }) => [
    "--acp",
    ...(model ? ["--model", model] : []),
    ...(mcpServers ? ["--allowed-mcp-server-names", Object.keys(mcpServers).join(",")] : []),
    ...(mcpServers ? ["--skip-trust"] : []),
    "--yolo"
  ],
  env: {
    GEMINI_SANDBOX: "false"
  },
  skipAuth: true
};
