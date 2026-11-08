import {native} from "./native.js";
export function statePolicy(operation:"job"|"template"|"templates",input:unknown):boolean|[string,unknown][] {
 const values:unknown[]=[];
 function intern(value:unknown):number{const id=values.length;values.push(value);return id;}
 function hook(operation:string,args:unknown[]):string{
  const [id,key]=args as [number,string];const value=values[id];let result:unknown;
  switch(operation){
   case "stateKind":result=value===undefined?0:typeof value==="string"?2:typeof value==="number"?3:value!==null&&typeof value==="object"?1:5;break;
   case "stateRecord":result=value!==null&&typeof value==="object"&&!Array.isArray(value);break;
   case "stateArray":result=Array.isArray(value);break;
   case "read":result=intern((value as Record<string,unknown>)[key]);break;
   case "text":result=value;break;
   case "numeric":result=Number.isFinite(value)?value:null;break;
   case "strings":result=Boolean((value as unknown[]).every(entry=>typeof entry==="string"));break;
   case "entries":result=Object.entries(value as object).map(([key,value])=>[key,intern(value)]);break;
   default:throw new Error(`Unknown state host operation: ${operation}`);
  }
  return JSON.stringify(result);
 }
 const result=native.configStatePolicy(operation,intern(input),hook);
 if(typeof result==="boolean")return result;
 return result.map(([hash,id])=>[hash,values[id]]);
}
