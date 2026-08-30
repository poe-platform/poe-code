import fs from 'node:fs';
import {createHash} from 'node:crypto';
const packet="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829",work="/tmp/safe-bash-b35-author-xSdFBJ",sealPin={"bytes":5439,"sha256":"52c705866d3a515d17a1d89f2e3870182153be4c6c1714047189afcabc009127"};
const started=Date.now(),out=fs.openSync(work+'/capture/owner.stdout','wx+',0o600),err=fs.openSync(work+'/capture/owner.stderr','wx+',0o600);
let primaryPresent=false,primary;const secondary=[];const fail=reason=>{if(!primaryPresent){primaryPresent=true;primary=reason;}else secondary.push({kind:reason===null?"null":typeof reason,name:reason?.name,message:String(reason?.message??reason).slice(0,2048)});};
try{
 const filename=packet+'/PRESEAL.json',stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==sealPin.bytes)throw Error('OUTER_SEAL_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(createHash('sha256').update(bytes).digest('hex')!==sealPin.sha256)throw Error('OUTER_SEAL_HASH');const seal=JSON.parse(bytes);
 for(const [name,pin]of Object.entries(seal.files)){const filename=packet+'/'+name,stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes)throw Error('OUTER_FILE_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('OUTER_FILE_HASH');}
 const {run}=await import('./supervisor.mjs');const completed=await run(packet,seal,started);fs.writeFileSync(out,JSON.stringify({status:completed.result.status,semanticPass:completed.result.semanticPass,semanticFail:completed.result.semanticFail,knownStarts:completed.result.ledger.starts,source:seal.sourceCommit,primaryPresent:completed.primary.present})+'\n');if(completed.primary.present){primaryPresent=true;primary=completed.primary.reason;}
}catch(reason){primaryPresent=true;primary=reason;fs.writeFileSync(err,JSON.stringify({primaryPresent:true,kind:reason===null?'null':typeof reason,name:reason?.name,message:reason?.message??String(reason)})+'\n');}
finally{for(const descriptor of [out,err]){try{fs.fsyncSync(descriptor);}catch(reason){fail(reason);}try{fs.closeSync(descriptor);}catch(reason){fail(reason);}}}
if(primaryPresent){process.stderr.write('B35_AUTHOR_STOP\n');process.exitCode=1;}else process.stdout.write('B35_AUTHOR_COMPLETED\n');
