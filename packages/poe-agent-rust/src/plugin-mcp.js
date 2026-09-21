import { cloneMcpServerConfig } from "./config.js";
export default function mcpPlugin(config) {
  const server = cloneMcpServerConfig(config);
  return Object.freeze({
    name: `mcp:${server.name}`,
    setup(api) {
      api.addMcp(server);
    }
  });
}
