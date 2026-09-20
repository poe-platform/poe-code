import {native}from'./native.js';import {admit,files}from'./host.js';import {resolveAgentSupport}from'./configs.js';
const engine=new native.HookBridge(),states=new WeakMap();
export function bridgeHooks(sourceAgentId,targetAgentId,cwd,homeDir,runId,opts){
 const payload={source:resolveAgentSupport(sourceAgentId),target:resolveAgentSupport(targetAgentId),cwd,home:homeDir,runId,strategy:opts?.strategy??'auto',scope:opts?.scope??'merged'};
 const {manifest,state}=files(callback=>engine.begin(admit(payload),callback));
 for(const drop of manifest.drops)if(!Object.hasOwn(drop.source,'matcher'))drop.source.matcher=undefined;
 if(state!==null)states.set(manifest,state);
 return manifest;
}
export function cleanupBridgedHooks(manifest){
 const state=states.get(manifest);if(state?.cleaned)return;
 const payload={manifest:{strategy:manifest.strategy,cwd:manifest.cwd,runId:manifest.runId,writtenPath:manifest.writtenPath,symlinkPath:manifest.symlinkPath,symlinkTarget:manifest.symlinkTarget,symlinkCreated:manifest.symlinkCreated,createdParents:manifest.createdParents,fileCreated:manifest.fileCreated,preExistingEvents:manifest.preExistingEvents,preExistingMatchers:manifest.preExistingMatchers},state};
 files(callback=>engine.cleanup(admit(payload),callback));if(state)state.cleaned=true;
}
