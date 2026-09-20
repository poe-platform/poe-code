import {native} from './native.js';
import {graphSnapshot} from './config/yaml-snapshot.js';
export class FrontmatterParseError extends Error{constructor(message){super(message);this.name='FrontmatterParseError';}}
export class FrontmatterKindError extends FrontmatterParseError{constructor(message,kinds){super(message);this.name='FrontmatterKindError';this.expectedKind=kinds.expected;this.foundKind=kinds.found;}}
export function isFrontmatterKindError(error){return error instanceof Error&&error.name==='FrontmatterKindError'&&typeof error.expectedKind==='string'&&typeof error.foundKind==='string';}
export function splitFrontmatterBlock(source){
 const result=native.frontmatterInspect(source);
 if(result.kind==='body')return {body:source};
 if(result.kind==='missing-closing-fence')throw new Error('Missing YAML frontmatter end delimiter (---).');
 return {raw:source.slice(result.rawStart,result.rawEnd),rawStart:result.rawStart,rawEnd:result.rawEnd,body:source.slice(result.bodyStart)};
}
function materialize(result){
 const dates=new Map(),symbols=new Map();let dateIndex=0,symbolIndex=0;
 for(const[path,epoch,description]of result.temporals){
  let value;
  if(epoch==='symbol'){const id=result.symbolIds[symbolIndex++];if(!symbols.has(id))symbols.set(id,Symbol(description));value=symbols.get(id);}
  else{const id=result.dateIds[dateIndex++];if(!dates.has(id))dates.set(id,new Date(epoch));value=dates.get(id);}
  let parent=result.value;for(let index=0;index<path.length-1;index++)parent=parent[path[index]];
  Object.defineProperty(parent,path.at(-1),{value,writable:true,enumerable:true,configurable:true});
 }
 return result.value;
}
function read(source,options){return native.frontmatterParse(source,options.uniqueKeys??false,epoch=>new Date(epoch).toString());}
export function parseFrontmatter(source,options={}){
 // Absent fences never consult caller options, matching the original API.
 const split=native.frontmatterInspect(source);
 if(split.kind==='body')return {frontmatter:{},body:source};
 if(split.kind==='missing-closing-fence')throw new FrontmatterParseError('Missing YAML frontmatter end delimiter (---).');
 const result=read(source,options);
 if(result.errors.length)throw new FrontmatterParseError(result.errors[0].parseMessage);
 return {frontmatter:materialize(result),body:source.slice(result.bodyStart)};
}
class LineCounter{
 constructor(starts){this.lineStarts=starts;}
 addNewLine=offset=>this.lineStarts.push(offset);
 linePos=offset=>{
  let low=0,high=this.lineStarts.length;
  while(low<high){const middle=(low+high)>>1;if(this.lineStarts[middle]<offset)low=middle+1;else high=middle;}
  if(this.lineStarts[low]===offset)return {line:low+1,col:1};
  return low===0?{line:0,col:offset}:{line:low,col:offset-this.lineStarts[low-1]+1};
 };
}
export function parseFrontmatterDocument(source,options={}){
 const split=native.frontmatterInspect(source);
 const result=read(source,split.kind==='frontmatter'?options:{});
 return {frontmatter:materialize(result),body:source.slice(result.bodyStart),errors:result.errors.map(error=>({message:error.message,...(error.pos===undefined?{}:{pos:error.pos})})),lineCounter:new LineCounter(result.lineStarts)};
}
function plain(value){if(typeof value!=='object'||value===null||Array.isArray(value))return false;const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null;}
function assertAcyclic(root){
 const active=new Set(),tasks=[{kind:'visit',value:root}];
 try{
  while(tasks.length){
   const task=tasks.pop();
   if(task.kind==='leave'){active.delete(task.value);continue;}
   if(task.kind==='next'){
    const item=task.iterator.next();if(item.done)continue;
    tasks.push(task,{kind:'visit',value:item.value});continue;
   }
   const value=task.value;
   if(typeof value!=='object'||value===null)continue;
   if(active.has(value))throw new FrontmatterParseError('Cannot stringify cyclic frontmatter.');
   active.add(value);const values=Array.isArray(value)?value:Object.values(value);
   tasks.push({kind:'leave',value},{kind:'next',iterator:values[Symbol.iterator]()});
  }
 }catch(error){for(let index=tasks.length-1;index>=0;index--){const task=tasks[index];if(task.kind==='next')try{task.iterator.return?.();}catch{}}throw error;}
}
export function stringifyFrontmatter(frontmatter,body){
 try{
  if(!plain(frontmatter))throw new FrontmatterParseError('YAML frontmatter must parse to an object.');
  assertAcyclic(frontmatter);
  return `---\n${native.configYamlSerialize(graphSnapshot(frontmatter,false)).trimEnd()}\n---\n${body}`;
 }catch(error){if(error instanceof FrontmatterParseError)throw error;throw new FrontmatterParseError('Invalid YAML frontmatter: '+(error instanceof Error?error.message:'Unknown YAML stringify error'));}
}
