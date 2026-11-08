import type {SkillRuntimeOptions} from './discover-skills-async.js';
import type {BridgeManifest} from './bridge-active-skills.js';
export declare function bridgeActiveSkillsAsync(spawnAgentId: string, refs: string[], runId: string, options: SkillRuntimeOptions): Promise<BridgeManifest>;
export declare function cleanupBridgedSkillsAsync(manifest: BridgeManifest, options: SkillRuntimeOptions): Promise<void>;
