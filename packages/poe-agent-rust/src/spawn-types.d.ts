export type SpawnMode = "yolo" | "auto" | "edit" | "read";
export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * Whether Codex should automatically approve tools exposed by this explicitly configured server.
   * Defaults to true so headless read/edit spawns can use caller-trusted MCP tools.
   */
  autoApprove?: boolean;
  /**
   * Maximum time in seconds the agent should wait for a single tool call
   * to this MCP server before timing out. Omit to use the agent's default.
   */
  timeout?: number;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;
