import {createRequire} from 'node:module';
import {isConfigObject,hasConfigEntry,merge,prune} from './object.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node');
export const detectIndent=native.configJsonIndent;
export function modifyAtPath(content,path,value){
 const plan=native.configJsonPlan(content,path.slice(),value!==undefined);
 try{
 for(const wrapper of plan.wrappers)value=typeof wrapper==='string'?{[wrapper]:value}:[value];
 const serialized=JSON.stringify(value);
 if(serialized===undefined&&plan.replacesValue)throw new TypeError("Cannot read properties of undefined (reading 'length')");
 return plan.apply(serialized);
 }catch(error){plan.discard();throw error;}
}
export function removeAtPath(content,path){const plan=native.configJsonPlan(content,path.slice(),false);return plan.apply();}
export function serializeUpdate(content,current,next){
 let result=content||'{}';
 function update(path,current,next){
  for(const key of Object.keys(current)){if(!hasConfigEntry(next,key))result=removeAtPath(result,[...path,key]);}
  for(const[key,value]of Object.entries(next)){
   const present=hasConfigEntry(current,key);const existing=present?current[key]:undefined;
   if(present&&isConfigObject(existing)&&isConfigObject(value)){update([...path,key],existing,value);continue;}
   if(!present||JSON.stringify(existing)!==JSON.stringify(value))result=modifyAtPath(result,[...path,key],value);
  }
 }
 update([],current,next);return result.endsWith('\n')?result:result+'\n';
}
export function mergePreservingComments(content,patch){const current=native.configJsonParse(content);return serializeUpdate(content||'{}',current,merge(current,patch));}
export const jsonFormat={parse:native.configJsonParse,serialize(obj){return JSON.stringify(obj,null,2)+'\n';},serializeUpdate,merge,prune};
