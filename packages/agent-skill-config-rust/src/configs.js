import path from 'node:path';import os from 'node:os';import {native}from'./native.js';
const {configs,agents,lookup}=native.skillRegistry();
export const supportedAgents=Object.freeze(agents);
export function resolveAgentSupport(input,registry=configs){const key=input.trim().toLowerCase(),id=Object.hasOwn(lookup,key)?lookup[key]:undefined,config=id===undefined?undefined:registry[id];const result=native.skillSupport(input,id,Boolean(config));if(config)result.config={...config};return result;}
export function getAgentConfig(input){return resolveAgentSupport(input).config;}
export function resolveSkillDir(config,scope,cwd,homeDir,paths=path){
 const resolve=paths.resolve,global=scope==='global';
 let globalDir='',localDir='',home='';
 if(global){globalDir=config.globalSkillDir;home=homeDir===undefined?os.homedir():homeDir;}
 else localDir=config.localSkillDir;
 const plan=native.skillPath(globalDir,localDir,global?'global':'local',global?'':cwd,home);
 if(plan.kind==='from')return Reflect.apply(resolve,paths,[plan.directory,plan.path]);
 return Reflect.apply(resolve,paths,[plan.kind==='join'?paths.join(plan.directory,plan.path):plan.path]);
}
