import path from 'node:path';import os from 'node:os';import {native}from'./native.js';
const {configs,agents,lookup}=native.skillRegistry();
export const supportedAgents=Object.freeze(agents);
export function resolveAgentSupport(input,registry=configs){const key=input.trim().toLowerCase(),id=Object.hasOwn(lookup,key)?lookup[key]:undefined,config=id===undefined?undefined:registry[id];const result=native.skillSupport(input,id,Boolean(config));if(config)result.config={...config};return result;}
export function getAgentConfig(input){return resolveAgentSupport(input).config;}
export function resolveSkillDir(config,scope,cwd,homeDir=os.homedir()){const plan=native.skillPath(config.globalSkillDir,config.localSkillDir,scope,cwd,homeDir);if(plan.kind==='from')return path.resolve(plan.directory,plan.path);return path.resolve(plan.kind==='join'?path.join(plan.directory,plan.path):plan.path);}
