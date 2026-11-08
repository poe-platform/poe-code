import {recordSnapshot} from "./record-snapshot.js";
import {native} from "./native.js";
import type {ConfigDocument} from "./types.js";
export function documentPolicy(operation:"normalize"|"scope"|"merge",value:unknown,override?:unknown):ConfigDocument {
 const snapshot=recordSnapshot(operation,value,override);
 if(snapshot!==null){
  const result=native.configOwnedDocument(snapshot.buffer,snapshot.root,snapshot.override,operation);
  for(const [path,id]of result.references){
   let parent:Record<string|number,unknown>=result;
   for(let n=0;n<path.length-1;n++)parent=parent[path[n]] as Record<string|number,unknown>;
   Object.defineProperty(parent,path.at(-1)!,{value:id<0?undefined:snapshot.references[id],configurable:true,enumerable:true,writable:true});
  }
  return result.data;
 }
 const values:unknown[]=[];
 function intern(value:unknown):number {const id=values.length;values.push(value);return id;}
 function hook(operation:string,args:unknown[]):string {
  const [id,key,handle]=args as [number,string,number];let result:unknown;
  switch(operation) {
   case "record": {const value=values[id];result=value!==null&&typeof value==="object"&&!Array.isArray(value);break;}
   case "undefined":result=values[id]===undefined;break;
   case "keys":result=Object.keys(values[id] as object);break;
   case "own":result=intern(Object.prototype.hasOwnProperty.call(values[id],key)?(values[id] as Record<string,unknown>)[key]:undefined);break;
   case "entries":result=Object.entries(values[id] as object).map(([key,value])=>[key,intern(value)]);break;
   case "create":result=intern({});break;
   case "define":Object.defineProperty(values[id],key,{value:values[handle],configurable:true,enumerable:true,writable:true});result=true;break;
   default:throw new Error(`Unknown config host operation: ${operation}`);
  }
  return JSON.stringify(result);
 }
 const id=intern(value);
 const result=operation==="normalize"?native.configNormalize(id,hook):operation==="scope"?native.configNormalizeScope(id,hook):native.configMerge(id,intern(override),hook);
 return values[result] as ConfigDocument;
}
