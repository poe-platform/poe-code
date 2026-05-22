import type { AcpSpawnConfig } from "../types.js";

export const geminiCliAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "gemini-cli",
  acpArgs: ({ model }) => [
    "--acp",
    ...(model ? ["--model", model] : []),
    "--yolo"
  ],
  env: {
    GEMINI_SANDBOX: "false"
  },
  skipAuth: true
};
