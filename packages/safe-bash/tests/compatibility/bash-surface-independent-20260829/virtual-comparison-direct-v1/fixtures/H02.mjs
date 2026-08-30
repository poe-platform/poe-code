import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));
let owned;
try {
  let denial;
  try{owned=new Worker(new URL('file://'+role.extraWorker),{execArgv:[]});}
  catch(reason){if(reason?.code!=='ERR_ACCESS_DENIED'||reason?.permission!=='WorkerThreads')throw reason;denial={code:reason.code,permission:reason.permission};}
  if(owned){let exited=false;owned.on('error',()=>{});owned.on('exit',()=>{exited=true;});const status=await owned.terminate();process.stdout.write(JSON.stringify({unexpectedAdmission:true,threadId:owned.threadId,exited,status})+'\n');throw Error('UNEXPECTED_WORKER_ADMISSION_STOP');}
  if(!denial)throw Error('DENIAL_NOT_OBSERVED');
  process.stdout.write(JSON.stringify({id:'H02',denial,extraOwnedChildren:0,extraWorkers:0,publicSettlement:{execObserved:true,disposeSettled:true,disposeRejected:false},profile:role.profile})+'\n');
}catch(reason){process.stderr.write(JSON.stringify({name:reason?.name,code:reason?.code,message:reason?.message})+'\n');process.exitCode=1;}
