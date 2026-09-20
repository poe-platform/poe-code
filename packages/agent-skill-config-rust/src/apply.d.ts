import type {ApplyOptions,SkillFile} from './types.js';
export class UnsupportedAgentError extends Error {constructor(agentId:string);}
export function configure(agentId:string,options:ApplyOptions):Promise<void>;
export function unconfigure(agentId:string,options:ApplyOptions&{force?:boolean}):Promise<void>;
export type InstallSkillOptions={fs:ApplyOptions['fs'];cwd:string;homeDir:string;scope:ApplyOptions['scope'];dryRun?:boolean;observers?:ApplyOptions['observers'];force?:boolean};
export type InstallSkillResult={skillPath:string;displayPath:string};
export function installSkill(agentId:string,skill:SkillFile,options:InstallSkillOptions):Promise<InstallSkillResult>;
