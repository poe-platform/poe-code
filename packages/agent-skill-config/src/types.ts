import type { FileSystem, MutationObservers } from "@poe-code/config-mutations";
import type { SkillScope } from "./configs.js";

export interface ApplyOptions {
  fs: FileSystem;
  homeDir: string;
  cwd: string;
  scope?: SkillScope;
  dryRun?: boolean;
  observers?: MutationObservers;
}

export interface SkillFile {
  /** Skill folder name */
  name: string;
  /** Content to write to SKILL.md */
  content: string;
}

