import type { AcpSpawnConfig } from "../types.js";

export const geminiCliAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "gemini-cli",
  acpArgs: ({ model }) => [
    "--acp",
    "--sandbox=false",
    ...(model ? ["--model", model] : []),
    "--yolo"
  ],
  skipAuth: true
};
