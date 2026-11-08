import fs from 'node:fs';
import {readPinned,pinExecutable,publish} from './auth.mjs';
import {collect} from './collector-core.mjs';
import {preauthRecord} from './preauth.mjs';
import {validateActivation} from './activation.mjs';
const packet="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future",work="/private/tmp/safe-bash-k08-author-RAvH2m",started=Date.now();let primaryPresent=false,primary;
try{
 const seal=JSON.parse(readPinned(packet+'/SEAL.json',{bytes:Number(process.env.K08_SEAL_BYTES),sha256:process.env.K08_SEAL_SHA256}));for(const [name,pin]of Object.entries(seal.files))readPinned(packet+'/'+name,pin);pinExecutable(seal.node);
 const readAuth=(name,digest)=>{const stat=fs.lstatSync(packet+'/'+name);return JSON.parse(readPinned(packet+'/'+name,{bytes:stat.size,sha256:digest},65536));};
 const grant=readAuth('GO.json',process.env.K08_GRANT_SHA256),review=readAuth('REVIEW.json',process.env.K08_REVIEW_SHA256);const time=validateActivation(grant,review,{preseal:process.env.K08_SEAL_SHA256,work,limits:seal.limits,roles:seal.roles,started,now:Date.now()});
 const ledger={starts:1,maximum:2,active:0,stopped:false,captureBytes:0,captureMaximum:131072,rows:[]};
 const env={HOME:work+'/home',TMPDIR:work+'/tmp',PATH:work+'/empty-path',LC_ALL:'C',LANG:'C',TZ:'UTC',K08_SEAL_BYTES:process.env.K08_SEAL_BYTES,K08_SEAL_SHA256:process.env.K08_SEAL_SHA256,K08_GRANT_SHA256:process.env.K08_GRANT_SHA256,K08_REVIEW_SHA256:process.env.K08_REVIEW_SHA256};
 const child=await collect({id:'author-owner',node:seal.node,args:[packet+'/target-owner.mjs'],cwd:work,env,capture:work+'/future-capture/owner',timeoutMs:time.duration-5000,bodyDeadline:time.finalDeadline-5000,finalDeadline:time.finalDeadline},ledger);
 publish(work+'/future-capture/COLLECTOR.json',Buffer.from(JSON.stringify({ledger,ownerLifecycle:child.row})+'\n'),time.finalDeadline);
 if(!child.row.qualified||child.row.status!==0){primaryPresent=child.primary.present;primary=child.primary.reason;if(!primaryPresent){primaryPresent=true;primary=Error('OWNER_STOP');}}
}catch(reason){primaryPresent=true;primary=reason;}
process[primaryPresent?'stderr':'stdout'].write(JSON.stringify(primaryPresent?preauthRecord(true,primary):{status:'COLLECTOR_COMPLETED'})+'\n');if(primaryPresent)process.exitCode=1;
