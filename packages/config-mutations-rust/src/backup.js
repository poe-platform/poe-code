import {createRequire} from 'node:module';
import {writeWalk} from './path.js';
import {writeAtomically} from './io.js';
const native=createRequire(import.meta.url)('./config-mutations-rust.node');
function hasCode(error,code){return typeof error==='object'&&error!==null&&Object.hasOwn(error,'code')&&error.code===code;}
export async function applyBackup(mutation,context,target){
 const machine=new native.ConfigBackupMachine(mutation.kind,target,mutation.kind==='backup'?writeWalk(target,context.homeDir):[]);let request=machine.start(),pendingError;
 while(true){
  if(request.kind==='done')return request.outcome;
  if(request.kind==='error'){if(Object.hasOwn(request,'token'))throw pendingError;throw Error(request.message);}
  let response;
  try{switch(request.kind){
   case 'lstat':response={kind:'link',flag:(await context.fs.lstat(request.path)).isSymbolicLink()};break;
   case 'once':response={kind:'bool',flag:!!mutation.once};break;
   case 'dryRun':response={kind:'bool',flag:!!context.dryRun};break;
   case 'readdir':response={kind:'entries',entries:await context.fs.readdir(request.path)};break;
   case 'validateTimestamp':response={kind:'bool',flag:!Number.isNaN(Date.parse(request.timestamp))};break;
   case 'readFile':response={kind:'content',content:await context.fs.readFile(request.path,'utf8')};break;
   case 'timestamp':response={kind:'timestamp',content:new Date().toISOString()};break;
   case 'walk':response={kind:'walk',walk:writeWalk(request.path,context.homeDir)};break;
   case 'writeFile':await context.fs.writeFile(request.path,request.content,{encoding:'utf8',flag:'wx'});response={kind:'unit'};break;
   case 'writeAtomically':await writeAtomically(context,request.path,request.content);response={kind:'unit'};break;
   case 'unlink':await context.fs.unlink(request.path);response={kind:'unit'};break;
   default:throw Error(`Unknown backup filesystem request: ${request.kind}`);
  }}catch(error){
   const allowsMissing=request.kind==='lstat'||request.kind==='readdir'||request.kind==='readFile'&&request.missingAllowed||request.kind==='unlink'&&request.ignoreMissing;
   if(allowsMissing&&hasCode(error,'ENOENT'))response={kind:'missing'};
   else{const exists=(request.kind==='writeFile'||request.retryable===true)&&hasCode(error,'EEXIST');if(!exists&&!(request.kind==='unlink'&&request.cleanup))pendingError=error;response={kind:'failure',token:0,exists};}
  }
  request=machine.respond(response);
 }
}
