export type {
  McpStdioServer,
  McpHttpServer,
  McpServerConfig,
  McpServerEntry,
  ApplyOptions
} from "./types.js";

export type { AgentMcpConfig } from "./configs.js";
export {
  supportedAgents,
  isSupported,
  resolveAgentSupport,
  resolveConfigPath
} from "./configs.js";

export {
  configure,
  unconfigure,
  UnsupportedAgentError
} from "./apply.js";
