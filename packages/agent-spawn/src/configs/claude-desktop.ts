import type { FileSpawnConfig } from "../types.js";

export const claudeDesktopSpawnConfig = {
  kind: "file",
  // ACP adapter support: no (no `adapter` field on file configs)
  agentId: "claude-desktop"
} satisfies FileSpawnConfig;
