export type { AgentDefinition } from "./types.js";
export type { AgentSpecifier } from "./specifier.js";
export {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  gooseAgent
} from "./agents/index.js";
export { allAgents, resolveAgentId } from "./registry.js";
export { parseAgentSpecifier, formatAgentSpecifier } from "./specifier.js";
