import type { McpSpawnConfig } from "@poe-code/agent-spawn";

export interface AutomationDefinition {
  name: string;
  prompt: string;
  source?: string;
  agent?: string;
  mcp?: McpSpawnConfig;
  allow?: string[];
  prefix?: string;
}
