import type {FileSystem,MutationObservers}from'./mutations/execution.js';
import type {SkillScope}from'./configs.js';
export interface ApplyOptions{fs:FileSystem;homeDir:string;cwd:string;scope?:SkillScope;dryRun?:boolean;observers?:MutationObservers;}
export interface SkillFile{name:string;content:string;}
