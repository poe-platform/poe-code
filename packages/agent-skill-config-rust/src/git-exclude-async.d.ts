import type {SkillRuntimeOptions} from './discover-skills-async.js';
export declare function appendExcludeBlockAsync(options: SkillRuntimeOptions, runId: string, entries: string[], opts?: {markerPrefix?: string}): Promise<string | undefined>;
export declare function removeExcludeBlockAsync(options: SkillRuntimeOptions, runId: string, opts?: {markerPrefix?: string}): Promise<void>;
