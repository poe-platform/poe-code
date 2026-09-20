import {native} from './native.js';
import {runMutations} from './mutations/execution.js';
import {loadTemplate}from'./templates.js';
export class UnsupportedAgentError extends Error {
 constructor(agentId){super(`Unsupported agent: ${agentId}`);this.name='UnsupportedAgentError';}
}
function machine(operation,agent,options,skill){return new native.SkillApplyMachine(operation,agent,{cwd:options.cwd,home:options.homeDir,global:options.scope==null?undefined:options.scope==='global',force:!!options.force,name:skill?.name,content:skill?.content});}
async function preflight(machine,fs,agent){
 let request=machine.start();
 while(true){
  if(Object.hasOwn(request,'error')){if(request.unsupported)throw new UnsupportedAgentError(agent);const error=new Error(request.error);if(request.user){error.name='UserError';error.hint=undefined;}throw error;}
  if(request.kind==='done')return request;
  if(request.kind==='read'){request=machine.content(await fs.readFile(request.path,'utf8'));continue;}
  if(request.kind==='template'){request=machine.template(await loadTemplate(request.id));continue;}
  try{await fs.stat(request.path);request=machine.exists(true);}catch(error){if(!(error instanceof Error&&Object.hasOwn(error,'code')&&error.code==='ENOENT'))throw error;request=machine.exists(false);}
 }
}
export async function configure(agent,options){
 const plan=await preflight(machine('configure',agent,options),options.fs,agent);
 await runMutations(plan.mutations,{fs:options.fs,homeDir:plan.home,dryRun:options.dryRun,observers:options.observers,templates:loadTemplate});
}
export async function unconfigure(agent,options){
 const plan=await preflight(machine('unconfigure',agent,options),options.fs,agent);
 await runMutations(plan.mutations,{fs:options.fs,homeDir:plan.home,dryRun:options.dryRun,observers:options.observers});
}
export async function installSkill(agent,skill,options){
 const plan=await preflight(machine('install',agent,options,skill),options.fs,agent);
 await runMutations(plan.mutations,{fs:options.fs,homeDir:plan.home,dryRun:options.dryRun,observers:options.observers,templates:async id=>{if(id==='__skill_content__')return plan.template;throw new Error(`Unknown template: ${id}`);}});
 return plan.result;
}
