import {native} from './native.js';
import {randomUUID} from 'node:crypto';
import {writeWalk} from './path.js';
function hasCode(error,code){return typeof error==='object'&&error!==null&&Object.hasOwn(error,'code')&&error.code===code;}
// Internal platform adapter for config/template/restore handlers. The core owns
// retry and cleanup policy; temporaryPath is injected for deterministic tests.
export async function writeAtomically(context,target,content,{temporaryPath=()=>`${target}.mutation-tmp-${process.pid}-${randomUUID()}`}={}){
 const machine=new native.ConfigAtomicMachine(target,content,writeWalk(target,context.homeDir)),errors=[];let request=machine.start();
 while(true){
  if(request.kind==='done')return;
  if(request.kind==='error'){if(Object.hasOwn(request,'token'))throw errors[request.token];throw Error(request.message);}
  let response;
  try{switch(request.kind){
   case 'lstat':response={kind:'link',flag:(await context.fs.lstat(request.path)).isSymbolicLink()};break;
   case 'tempPath':{const path=temporaryPath();response={kind:'temp',path,walk:writeWalk(path,context.homeDir)};break;}
   case 'writeFile':await context.fs.writeFile(request.path,request.content,{encoding:'utf8',flag:'wx'});response={kind:'unit'};break;
   case 'rename':await context.fs.rename(request.from,request.to);response={kind:'unit'};break;
   case 'unlink':await context.fs.unlink(request.path);response={kind:'unit'};break;
   default:throw Error(`Unknown atomic filesystem request: ${request.kind}`);
  }}catch(error){
   if(request.kind==='lstat'&&hasCode(error,'ENOENT'))response={kind:'missing'};
   else{
    let exists=false;
    if(request.kind==='writeFile'||request.kind==='rename'||request.kind==='lstat'&&request.retryable)exists=hasCode(error,'EEXIST');
    else if(request.kind==='unlink')hasCode(error,'ENOENT');
    const token=errors.length;errors.push(error);response={kind:'failure',token,exists};
   }
  }
  request=machine.respond(response);
 }
}
