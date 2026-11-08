import type {SkillRuntimeOptions} from './discover-skills-async.js';
import type {SkillResolution} from './resolve-skill-reference.js';
export declare function resolveSkillReferenceAsync(ref: string, options: SkillRuntimeOptions): Promise<SkillResolution>;
