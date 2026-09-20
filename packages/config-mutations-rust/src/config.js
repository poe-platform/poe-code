import {createRequire} from 'node:module';
import {jsonFormat} from './json.js';
import {tomlFormat} from './toml.js';
import {yamlFormat} from './yaml.js';
import {isConfigObject,mergeWithPruneByPrefix} from './object.js';
import {writeAtomically} from './io.js';
import {applyBackup} from './backup.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node'),formats={json:jsonFormat,toml:tomlFormat,yaml:yamlFormat};
function resolveValue(value,options){return typeof value==='function'?value(options):value;}
function isNotFound(error){return typeof error==='object'&&error!==null&&Object.hasOwn(error,'code')&&error.code==='ENOENT';}
// Arbitrary JS documents, replacement identities, getters and transforms stay in
// the caller; the Rust policy sequences them and owns admission and outcomes.
export async function applyConfig(mutation,context,options,raw,target){
 const machine=new native.ConfigMutationMachine(mutation.kind,raw);let request=machine.start(),format,current,next,patch;
 try{while(true){
  if(request.error)throw Error(request.error);
  if(request.kind==='done')return request.outcome;
  let response;
  switch(request.kind){
   case 'format':{const selection=native.configSelectFormat(raw,mutation.format);if(selection.error)throw Error(selection.error);format=formats[selection.format];response={kind:'unit'};break;}
   case 'readFile':{try{response={kind:'content',content:await context.fs.readFile(target,'utf8')};}catch(error){if(!isNotFound(error))throw error;response={kind:'missing'};}break;}
   case 'parse':{try{current=format.parse(request.content);response={kind:'parsed',flag:true};}catch{response={kind:'parsed',flag:false};}break;}
   case 'fresh':current={};response={kind:'unit'};break;
   case 'backupInvalid':await applyBackup({kind:'invalidDocument'},context,target,request.content);response={kind:'unit'};break;
   case 'dryRun':response={kind:'bool',flag:!!context.dryRun};break;
   case 'guard':response={kind:'bool',flag:!mutation.onlyIf||!!mutation.onlyIf(current,options)};break;
   case 'value':patch=resolveValue(mutation.value,options);response={kind:'bool',flag:isConfigObject(patch)};break;
   case 'merge':next=mutation.pruneByPrefix?mergeWithPruneByPrefix(current,patch,mutation.pruneByPrefix):format.merge(current,patch);response={kind:'unit'};break;
   case 'prune':{const {changed,result}=format.prune(current,resolveValue(mutation.shape,options));next=result;response={kind:'pruned',changed:!!changed,empty:changed?Object.keys(result).length===0:false};break;}
   case 'transform':{const {content,changed}=mutation.transform(current,options);next=content;response={kind:'transformed',changed:!!changed,deleted:content===null};break;}
   case 'serialize':{const content=request.original!==null&&format.serializeUpdate?format.serializeUpdate(request.original,current,next):format.serialize(next);response={kind:'serialized',content};break;}
   case 'writeAtomically':await writeAtomically(context,target,request.content);response={kind:'unit'};break;
   case 'unlink':await context.fs.unlink(target);response={kind:'unit'};break;
   default:throw Error(`Unknown config mutation request: ${request.kind}`);
  }
  request=machine.respond(response);
 }}finally{machine.discard();}
}
