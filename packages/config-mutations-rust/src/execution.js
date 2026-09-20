import {applyConfig} from './config.js';
import {isNotFound} from './fs-utils.js';
import {applyTemplate} from './template.js';
import {applyBackup} from './backup.js';
import {writeWalk} from './path.js';
import path from 'node:path';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./config-mutations-rust.node');
function factories(specifications){return Object.fromEntries(specifications.map(({name,kind,fields})=>[name,options=>Object.fromEntries([['kind',kind],...fields.map(field=>[field,options[field]])])]));}
const layouts=native.configMutationFactories(),knownKinds=new Set(Object.values(layouts).flatMap(group=>group.map(factory=>factory.kind)));
export const fileMutation=factories(layouts.file);
export const configMutation=factories(layouts.config);
export const templateMutation=factories(layouts.template);
function expandHome(target,home){
 if(target.startsWith('~./'))target=`~/.${target.slice(3)}`;
 let remainder=target.slice(1);
 if(remainder.startsWith('/')||remainder.startsWith('\\'))remainder=remainder.slice(1);
 else if(remainder.startsWith('.')){remainder=remainder.slice(1);if(remainder.startsWith('/')||remainder.startsWith('\\'))remainder=remainder.slice(1);}
 return remainder.length===0?home:path.join(home,remainder);
}
function resolvePath(raw,context){
 if(typeof raw!=='string'||raw.length===0)throw Error('Target path must be a non-empty string.');
 if(!raw.startsWith('~'))throw Error(`All target paths must be home-relative (start with ~). Received: "${raw}"`);
 const expanded=expandHome(raw,context.homeDir),canonical=path.resolve(expanded),relative=path.relative(path.resolve(context.homeDir),canonical);
 if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error(`Target path resolves outside home directory: "${raw}"`);
 if(!context.pathMapper)return canonical;
 const directory=context.pathMapper.mapTargetDirectory({targetDirectory:path.dirname(expanded)}),filename=path.basename(expanded);
 return filename.length===0?directory:path.join(directory,filename);
}
function resolveTarget(mutation,options){const kind=mutation.kind;if(!knownKinds.has(kind))return undefined;const value=['ensureDirectory','removeDirectory'].includes(kind)?mutation.path:mutation.target;return typeof value==='function'?value(options):value;}
function label(kind,target){const display=target??'target';switch(kind){case 'ensureDirectory':return `Create ${display}`;case 'removeDirectory':return `Remove directory ${display}`;case 'removeFile':return `Remove ${display}`;case 'chmod':return `Set permissions on ${display}`;case 'backup':return `Backup ${display}`;case 'restoreBackup':return `Restore ${display}`;case 'configMerge':case 'configPrune':case 'configTransform':case 'templateMergeJson':case 'templateMergeToml':return `Update ${display}`;case 'templateWrite':return `Write ${display}`;default:return 'Operation';}}
function pendingDetails(mutation,context,options){
 try{const raw=resolveTarget(mutation,options);if(raw===undefined)return {kind:mutation.kind,label:mutation.label??mutation.kind};
  try{const targetPath=resolvePath(raw,context);return {kind:mutation.kind,label:mutation.label??label(mutation.kind,targetPath),targetPath};}
  catch{return {kind:mutation.kind,label:mutation.label??label(mutation.kind,raw),targetPath:undefined};}
 }catch{return {kind:mutation.kind,label:mutation.label??mutation.kind};}
}

function prepareTarget(mutation,context,options){const raw=resolveTarget(mutation,options),target=resolvePath(raw,context);return {raw,target,details:{kind:mutation.kind,label:mutation.label??label(mutation.kind,target),targetPath:target}};}
async function applyFile(mutation,context,options){
 if(!knownKinds.has(mutation.kind))throw Error(`Unknown mutation kind: ${mutation.kind}`);
 if(['templateWrite','templateMergeJson','templateMergeToml'].includes(mutation.kind))return applyTemplate(mutation,context,options,()=>prepareTarget(mutation,context,options));
 const {raw,target:targetPath,details}=prepareTarget(mutation,context,options);
 if(['configMerge','configPrune','configTransform'].includes(mutation.kind))return {outcome:await applyConfig(mutation,context,options,raw,targetPath),details};
 if(mutation.kind==='backup'||mutation.kind==='restoreBackup')return {outcome:await applyBackup(mutation,context,targetPath),details};
 const machine=new native.ConfigFileMachine(mutation.kind,writeWalk(targetPath,context.homeDir));
 let request=machine.start();
 while(true){
  if(request.error)throw Error(request.error);
  if(request.kind==='done')return {outcome:request.outcome,details};
  let response;
  try{switch(request.kind){
   case 'chmodSupported':response={kind:'chmodSupported',flag:typeof context.fs.chmod==='function'};break;
   case 'directoryOptions':{const supported=typeof context.fs.rm==='function';response={kind:'directoryOptions',flag:supported,force:supported?!!mutation.force:false};break;}
   case 'mode':response={kind:'mode',mode:mutation.mode};break;
   case 'dryRun':response={kind:'dryRun',flag:!!context.dryRun};break;
   case 'lstat':response={kind:'link',flag:(await context.fs.lstat(request.path)).isSymbolicLink()};break;
   case 'stat':{const stat=await context.fs.stat(targetPath);response={kind:'stat',mode:typeof stat.mode==='number'?stat.mode:undefined};break;}
   case 'readFile':response={kind:'content',content:await context.fs.readFile(targetPath,'utf8')};break;
   case 'readdir':response={kind:'count',count:(await context.fs.readdir(targetPath)).length};break;
   case 'guard':{if(mutation.whenContentMatches)mutation.whenContentMatches.lastIndex=0;const matches=!mutation.whenContentMatches||mutation.whenContentMatches.test(request.content);response={kind:'guard',flag:matches,whenEmpty:matches?!!mutation.whenEmpty:false};break;}
   case 'mkdir':await context.fs.mkdir(targetPath,{recursive:true});response={kind:'unit'};break;
   case 'rm':await context.fs.rm(targetPath,{recursive:true,force:true});response={kind:'unit'};break;
   case 'unlink':await context.fs.unlink(targetPath);response={kind:'unit'};break;
   case 'chmod':await context.fs.chmod(targetPath,mutation.mode);response={kind:'unit'};break;
   default:throw Error(`Unknown native filesystem request: ${request.kind}`);
  }}catch(error){
   if(!isNotFound(error))throw error;
   if(request.kind==='lstat'||request.kind==='stat'||mutation.kind==='removeFile'||mutation.kind==='chmod')response={kind:'missing'};else throw error;
  }
  request=machine.respond(response);
 }
}
/** Execute supported file and configuration mutations in order with an injected filesystem. */
export async function runMutations(mutations,context,options){
 const effects=[],resolverOptions=options??{};let changed=false;
 for(const mutation of mutations){const pending=pendingDetails(mutation,context,resolverOptions);context.observers?.onStart?.(pending);
  try{const {outcome,details}=await applyFile(mutation,context,resolverOptions);context.observers?.onComplete?.(details,outcome);effects.push(outcome);if(outcome.changed)changed=true;}
  catch(error){context.observers?.onError?.(pending,error);throw error;}
 }
 return {changed,effects};
}
