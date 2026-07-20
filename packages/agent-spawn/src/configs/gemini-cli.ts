import { DEFAULT_SPAWN_MODE, type AcpSpawnConfig, type SpawnMode } from "../types.js";

const geminiApprovalModes: Record<SpawnMode, string> = {
  yolo: "yolo",
  auto: "default",
  edit: "auto_edit",
  read: "plan"
};

export const geminiCliAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "gemini-cli",
  acpArgs: ({ model, mode, mcpServers }) => [
    "--acp",
    ...(model ? ["--model", model] : []),
    ...(mcpServers ? ["--allowed-mcp-server-names", Object.keys(mcpServers).join(",")] : []),
    ...(mcpServers ? ["--skip-trust"] : []),
    "--approval-mode",
    geminiApprovalModes[mode ?? DEFAULT_SPAWN_MODE]
  ],
  env: {
    GEMINI_SANDBOX: "false"
  },
  skipAuth: true
};
