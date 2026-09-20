import path from 'node:path';
import {native} from './native.js';
import {FrontmatterParseError} from './frontmatter/index.js';
import {mergeSnapshot} from './merge-snapshot.js';
const maxForeignArrayDepth=32;
function materialize(result){
 const dates=new Map(),symbols=new Map();let dateIndex=0,symbolIndex=0;
 for(const[parts,epoch,description]of result.temporals){
  let value;
  if(epoch==='symbol'){const id=result.symbolIds[symbolIndex++];if(!symbols.has(id))symbols.set(id,Symbol(description));value=symbols.get(id);}
  else{const id=result.dateIds[dateIndex++];if(!dates.has(id))dates.set(id,new Date(epoch));value=dates.get(id);}
  let parent=result.value;for(let index=0;index<parts.length-1;index++)parent=parent[parts[index]];
  Object.defineProperty(parent,parts.at(-1),{value,writable:true,enumerable:true,configurable:true});
 }
 return result.value;
}
export function parseDocument(content,filePath){
 const result=native.extendsParseDocument(content,path.extname(filePath).toLowerCase(),filePath,value=>path.isAbsolute(value),epoch=>new Date(epoch).toString());
 if(result.error!==undefined){
  if(result.error.startsWith('Invalid JSON configuration in ')){
   try{JSON.parse(content.startsWith('\ufeff')?content.slice(1):content);}catch(error){throw new Error(`Invalid JSON configuration in ${filePath}: ${error instanceof Error?error.message:'Unknown JSON parse error'}`);}
  }
  if(result.error.startsWith('Invalid YAML frontmatter: ')||result.error==='YAML frontmatter must parse to an object.')throw new FrontmatterParseError(result.error);
  throw new Error(result.error);
 }
 return {data:materialize(result),format:result.format,extends:result.extends,hasExtendsField:result.hasExtendsField};
}
export function mergeLayers(layers){
 const snapshot=mergeSnapshot(layers);
 if(snapshot!==null){
  const result=native.extendsOwnedMerge(snapshot.buffer);
  for(const[path,id]of result.references){let parent=result;for(let index=0;index<path.length-1;index++)parent=parent[path[index]];Object.defineProperty(parent,path.at(-1),{value:id<0?undefined:snapshot.references[id],enumerable:true,writable:true,configurable:true});}
  return {data:result.data,sources:result.sources};
 }
 const values=[],objects=new WeakMap(),iterators=new Map();let nextIterator=0,arrayDepth=0;
 function intern(value){if(value!==null&&(typeof value==='object'||typeof value==='function')){if(objects.has(value))return objects.get(value);const id=values.length;values.push(value);objects.set(value,id);return id;}const id=values.length;values.push(value);return id;}
 function hook(operation,args){
  const[id,key,value]=args;let result;
  switch(operation){
   case 'layerData':result=intern(values[id].data);break;
   case 'layerSource':result=values[id].source;break;
   case 'kind':result=values[id]===undefined?0:values[id]===null?1:values[id]===''?2:3;break;
   case 'plain':{const value=values[id];if(value===null||typeof value!=='object'||Array.isArray(value)){result=false;break;}const prototype=Object.getPrototypeOf(value);result=prototype===Object.prototype||prototype===null;break;}
   case 'array':result=Array.isArray(values[id]);break;
   case 'keys':result=Object.keys(values[id]);break;
   case 'own':result=intern(Object.prototype.hasOwnProperty.call(values[id],key)?values[id][key]:undefined);break;
   case 'entries':result=[];for(const[name,value]of Object.entries(values[id]))result.push([name,intern(value)]);break;
   case 'sequence':{const sequence=key?values[id]:Object.values(values[id]);const iterator=sequence[Symbol.iterator]();result=nextIterator++;iterators.set(result,iterator);break;}
   case 'next':{let item;try{item=iterators.get(id).next();}catch(error){iterators.delete(id);throw error;}result=item.done?null:intern(item.value);break;}
   case 'close':{const iterator=iterators.get(id);iterators.delete(id);if(key)try{iterator.return?.();}catch{}result=true;break;}
   case 'create':result=intern(id===null?{}:Object.create(Object.getPrototypeOf(values[id])));break;
   case 'define':Object.defineProperty(values[id],key,{value:values[value],enumerable:true,configurable:true,writable:true});result=true;break;
   case 'map':if(arrayDepth>=maxForeignArrayDepth)throw new Error(`Maximum foreign array depth exceeded (${maxForeignArrayDepth}).`);arrayDepth++;try{result=intern(values[id].map(entry=>values[native.extendsForeignClone(intern(entry),key+1,hook)]));}finally{arrayDepth--;}break;
   default:throw new Error(`Unknown foreign merge operation: ${operation}`);
  }
  return JSON.stringify(result);
 }
 const inputs=[];for(const layer of layers)inputs.push(intern(layer));
 const result=native.extendsForeignMerge(inputs,hook);return {data:values[result.data],sources:result.sources};
}
export {findBase,resolve,resolvePromptDocument} from './resolution.js';
