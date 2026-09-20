import {native} from './native.js';
import {jsonFormat} from './json.js';
import {tomlFormat} from './toml.js';
import {yamlFormat} from './yaml.js';
import {isConfigObject,mergeWithPruneByPrefix} from './object.js';
import {writeAtomically} from './io.js';
import {isNotFound} from './fs-utils.js';
import {applyBackup} from './backup.js';
const formats={json:jsonFormat,toml:tomlFormat,yaml:yamlFormat};
function resolveValue(value,options){return typeof value==='function'?value(options):value;}
// Foreign documents stay in one interpreter for the complete operation. Rust
// owns request order and outcomes, including the separate template merge policy.
export function configRequests(mutation,context,options,raw,target,initial={}){
 let format=initial.format,current,next,patch=initial.patch;
 return async function(request){
  switch(request.kind){
   case 'format':{const selection=native.configSelectFormat(raw,mutation.format);if(selection.error)throw Error(selection.error);format=formats[selection.format];return {kind:'unit'};}
   case 'readFile':{try{return {kind:'content',content:await context.fs.readFile(target,'utf8')};}catch(error){if(!isNotFound(error))throw error;return {kind:'missing'};}}
   case 'parse':{try{current=format.parse(request.content);return {kind:'parsed',flag:true};}catch{return {kind:'parsed',flag:false};}}
   case 'fresh':current={};return {kind:'unit'};
   case 'backupInvalid':await applyBackup({kind:'invalidDocument'},context,target,request.content);return {kind:'unit'};
   case 'dryRun':return {kind:'bool',flag:!!context.dryRun};
   case 'guard':return {kind:'bool',flag:!mutation.onlyIf||!!mutation.onlyIf(current,options)};
   case 'value':patch=resolveValue(mutation.value,options);return {kind:'bool',flag:isConfigObject(patch)};
   case 'merge':next=!initial.format&&mutation.pruneByPrefix?mergeWithPruneByPrefix(current,patch,mutation.pruneByPrefix):format.merge(current,patch);return {kind:'unit'};
   case 'prune':{const {changed,result}=format.prune(current,resolveValue(mutation.shape,options));next=result;return {kind:'pruned',changed:!!changed,empty:changed?Object.keys(result).length===0:false};}
   case 'transform':{const {content,changed}=mutation.transform(current,options);next=content;return {kind:'transformed',changed:!!changed,deleted:content===null};}
   case 'serialize':{const content=request.original!==null&&format.serializeUpdate?format.serializeUpdate(request.original,current,next):format.serialize(next);return {kind:'serialized',content};}
   case 'writeAtomically':await writeAtomically(context,target,request.content);return {kind:'unit'};
   case 'unlink':await context.fs.unlink(target);return {kind:'unit'};
   default:throw Error(`Unknown config mutation request: ${request.kind}`);
  }
 };
}
export async function applyConfig(mutation,context,options,raw,target){
 const machine=new native.ConfigMutationMachine(mutation.kind,raw),interpret=configRequests(mutation,context,options,raw,target);let request=machine.start();
 try{while(true){if(request.error)throw Error(request.error);if(request.kind==='done')return request.outcome;request=machine.respond(await interpret(request));}}
 finally{machine.discard();}
}
