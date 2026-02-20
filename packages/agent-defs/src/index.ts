export type { AgentDefinition } from "./types.js";
export {
  claudeCodeAgent,
  claudeDesktopAgent,
  codexAgent,
  openCodeAgent,
  kimiAgent,
  openClawAgent
} from "./agents/index.js";
export { allAgents, resolveAgentId } from "./registry.js";
