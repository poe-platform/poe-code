import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {native} from './native.js';
import {parseDocument,mergeLayers} from './index.js';
import {Snapshot} from './frontmatter/config/snapshot.js';
import {createTemplateEngine} from './design/engine.js';
const {renderTemplate}=createTemplateEngine(native),pool=[];
const nativeFs={readFile,realpath};
// This only marshals own, admitted values. Original data layers and views remain foreign.
function encode(root,references=[]){
 const output=new Snapshot(),active=new Set(),pending=[{value:root,depth:0}];let count=0;
 while(pending.length){
  const task=pending.pop();
  if(task.leave){active.delete(task.leave);continue;}
  if(task.key!==undefined){output.text(task.key);continue;}
  const {value,depth}=task;
  if(depth>512||++count>100000)throw new Error('Maximum resolution snapshot size exceeded.');
  if(value===null){output.tag(0);continue;}
  if(value===undefined){output.tag(1);continue;}
  switch(typeof value){
   case 'boolean':output.tag(value?3:2);continue;
   case 'number':output.tag(4);output.number(value);continue;
   case 'string':output.tag(5);output.text(value);continue;
  }
  const array=Array.isArray(value);
  if(typeof value!=='object'||!array&&![null,Object.prototype].includes(Object.getPrototypeOf(value))){output.tag(8);output.text(String(references.length));references.push(value);continue;}
  if(active.has(value))throw new Error('Cyclic config data is not supported.');
  active.add(value);pending.push({leave:value});
  if(array){output.tag(9);output.count(value.length);for(let index=value.length-1;index>=0;index--)pending.push({value:value[index],depth:depth+1});}
  else{const fields=Object.entries(value);output.tag(10);output.count(fields.length);for(let index=fields.length-1;index>=0;index--){const[key,item]=fields[index];pending.push({value:item,depth:depth+1},{key});}}
 }
 return output.finish();
}
function ownCode(error,code){return error!==null&&(typeof error==='object'||typeof error==='function')&&Object.prototype.hasOwnProperty.call(error,'code')&&error.code===code;}
function contains(directory,file){const relative=path.relative(path.resolve(directory),path.resolve(file));return relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
function restore(result,references){for(const[parts,id]of result.references??[]){let parent=result;for(let index=0;index<parts.length-1;index++)parent=parent[parts[index]];Object.defineProperty(parent,parts.at(-1),{value:id<0?undefined:references[id],enumerable:true,writable:true,configurable:true});}delete result.references;return result;}
async function drive(mode,config,fs,view){
 const references=[],errors=[],machine=pool.pop()??new native.ExtendsResolution();
 function hook(operation,args){
  try{
   const[first,second]=args;let result;
   switch(operation){
    case 'join':result=path.join(first,second);break;
    case 'contains':result=contains(first,second);break;
    case 'resolve':result=path.resolve(first);break;
    case 'dirname':result=path.dirname(first);break;
    case 'basename':result=path.basename(first,path.extname(first));break;
    case 'extension':result=path.extname(first).toLowerCase();break;
    case 'absolute':result=path.isAbsolute(first);break;
    case 'parseError':result=parseDocument(first,second);break;
    case 'dateKey':result=new Date(first).toString();break;
    case 'temporals':{const dates=new Map(),symbols=new Map();result=first.map(([kind,id,value])=>{const aliases=kind==='date'?dates:symbols;if(!aliases.has(id))aliases.set(id,kind==='date'?new Date(value):Symbol(value));const handle=references.length;references.push(aliases.get(id));return handle;});break;}
    case 'render':result=renderTemplate(first,view??{},{escape:'none',validate:second});break;
    default:throw new Error(`Unknown resolution host operation: ${operation}`);
   }
   return encode(result,references);
  }catch(error){return encode({bridgeError:errors.push(error)-1});}
 }
 try{
  machine.reset(mode,encode(config),hook);let result=machine.advance();
  while(result.request){
   let response;
   try{const value=result.request==='read'?await fs.readFile(result.path,'utf8'):await fs.realpath(result.path);response={value};}
   catch(error){const id=errors.push(error)-1;response=ownCode(error,'ENOENT')?{missing:id}:{error:id,notdir:ownCode(error,'ENOTDIR')};}
   result=machine.advance(encode(response));
  }
  if(Object.hasOwn(result,'foreignError'))throw errors[result.foreignError];
  if(Object.hasOwn(result,'error'))throw new Error(result.error);
  return restore(result,references);
 }finally{machine.discard();if(pool.length<8)pool.push(machine);}
}
export async function findBase(name,bases,fs){return drive('findBase',{name,bases},fs);}
export async function resolve(chain,options){
 // Classification checks presence without invoking original data getters.
 const classified=[];
 for(const layer of chain){
  if('data' in layer){classified.push({kind:'data'});continue;}
  if('filePath' in layer&&'content' in layer){classified.push({kind:'document',source:layer.source,filePath:layer.filePath,content:layer.content,baseName:layer.baseName});continue;}
  if('path' in layer){classified.push({kind:'base',source:layer.source,path:layer.path});continue;}
  classified.push({kind:'ignored'});
 }
 const prepared=await drive('resolve',{chain:classified,autoExtend:options.autoExtend===true,validate:options.validate===true,hasView:options.view!==undefined},options.fs,options.view);
 const index=prepared.documentIndex;
 const result=mergeLayers([...chain.slice(0,index).filter(layer=>'data' in layer),...prepared.layers,...chain.slice(index+1).filter(layer=>'data' in layer)]);
 if(prepared.promptSource!==null&&Object.hasOwn(result.sources,'prompt')&&result.sources.prompt===prepared.documentSource)result.sources.prompt=prepared.promptSource;
 return {...result,chain:prepared.chain};
}
export async function resolvePromptDocument(input){
 const config={cwd:input.cwd,filePath:input.filePath,content:input.content,optional:input.optional===true,basePaths:input.basePaths??[],baseDocuments:input.baseDocuments??[],validate:input.validate};
 return drive('promptDocument',config,input.fs??nativeFs,input.variables);
}
