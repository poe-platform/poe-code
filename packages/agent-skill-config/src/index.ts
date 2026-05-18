export type {
  AgentSkillConfig,
  AgentSupportResult,
  AgentSupportStatus,
  SkillScope
} from "./configs.js";

export type { ApplyOptions, SkillFile } from "./types.js";
export type {
  SkillResolution,
  SkillResolutionFailure,
  SkillSource
} from "./resolve-skill-reference.js";

export {
  supportedAgents,
  resolveAgentSupport,
  getAgentConfig,
  resolveSkillDir
} from "./configs.js";

export { configure, unconfigure, installSkill, UnsupportedAgentError } from "./apply.js";
export type { InstallSkillOptions, InstallSkillResult } from "./apply.js";

export { resolveSkillReference } from "./resolve-skill-reference.js";
