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
export type {
  BridgeEntry,
  BridgeManifest,
  BridgeWarning,
  BridgeWarningKind
} from "./bridge-active-skills.js";

export {
  supportedAgents,
  resolveAgentSupport,
  getAgentConfig,
  resolveSkillDir
} from "./configs.js";

export { configure, unconfigure, installSkill, UnsupportedAgentError } from "./apply.js";
export type { InstallSkillOptions, InstallSkillResult } from "./apply.js";

export { resolveSkillReference } from "./resolve-skill-reference.js";
export { appendExcludeBlock, removeExcludeBlock } from "./git-exclude.js";
export { setGitDirRunnerForTest } from "./git-exclude.js";
export { bridgeActiveSkills, cleanupBridgedSkills } from "./bridge-active-skills.js";

export { resolveSkillReferenceAsync } from "./resolve-skill-reference.js";
export type { SkillRuntimeOptions } from "./resolve-skill-reference.js";
export { appendExcludeBlockAsync, removeExcludeBlockAsync } from "./git-exclude.js";
export { bridgeActiveSkillsAsync, cleanupBridgedSkillsAsync } from "./bridge-active-skills-async.js";

export { discoverSkillsAsync } from "./discover-skills-async.js";
export type { DiscoveredSkill } from "./discover-skills-async.js";
