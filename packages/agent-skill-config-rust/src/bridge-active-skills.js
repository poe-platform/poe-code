import {native}from'./native.js';import {files}from'./host.js';
const engine=new native.SkillBridge(),states=new WeakMap();
export function bridgeActiveSkills(spawnAgentId,cwd,refs,homeDir,runId){
 const result=files((callback,bytes)=>engine.begin({spawn:spawnAgentId,cwd,refs,home:homeDir,run:runId},callback,bytes));
 states.set(result.manifest,{excludeBlockId:result.excludeBlockId??undefined,cleaned:false});return result.manifest;
}
export function cleanupBridgedSkills(manifest){
 const state=states.get(manifest);if(state?.cleaned)return;
 const payload=JSON.stringify({cwd:manifest.cwd,run:manifest.runId,exclude:state?.excludeBlockId??manifest.excludeBlockId??manifest.runId,targets:manifest.entries.map(entry=>entry.targetPath)});
 files((callback,bytes)=>engine.cleanup(payload,callback,bytes));if(state)state.cleaned=true;
}
