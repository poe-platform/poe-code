import { cloneMcpServerConfig } from "../runtime/config.js";
import type { AgentPlugin, McpServerConfig } from "../runtime/plugin-types.js";

export default function mcpPlugin(config: McpServerConfig): AgentPlugin {
  const server = cloneMcpServerConfig(config);

  return Object.freeze({
    name: `mcp:${server.name}`,
    setup(api) {
      api.addMcp(server);
    },
  });
}
