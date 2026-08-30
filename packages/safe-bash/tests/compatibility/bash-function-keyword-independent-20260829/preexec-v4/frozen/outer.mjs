import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {preauthRecord} from './preauth.mjs';
const packet="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4",work="/private/tmp/safe-bash-b35-v4-PLN3cC/future",started=Date.now();
let primaryPresent=false,primary,completed,finishOwner,publish,sample,wire;
try{
 const admit=(name,expected)=>{const filename=packet+'/'+name,stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8388608)throw Error('OUTER_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('OUTER_HASH');return bytes;};
 const seal=JSON.parse(admit('PRESEAL.json',process.env.B35_PRESEAL_SHA256));for(const [name,pin]of Object.entries(seal.files)){const bytes=admit(name,pin.sha256);if(bytes.length!==pin.bytes)throw Error('OUTER_SIZE');}
 ({finishOwner,wire}=await import('./owner-finalization.mjs'));({publish}=await import('./auth.mjs'));({sample}=await import('./package.mjs'));
 const grant=JSON.parse(admit('GO.json',process.env.B35_GRANT_SHA256)),review=JSON.parse(admit('REVIEW.json',process.env.B35_REVIEW_SHA256)),{validateActivation}=await import('./activation.mjs');
 validateActivation(grant,review,{preseal:process.env.B35_PRESEAL_SHA256,work,limits:seal.limits,roles:seal.roles,started,now:Date.now()});
 const {run}=await import('./supervisor.mjs');completed=await run(packet,{...seal,activationDeadline:grant.expiresEpochMs},started);primaryPresent=completed.finalState.primaryPresent;primary=completed.finalState.primary;
}catch(reason){primaryPresent=true;primary=reason;}
if(finishOwner){const state=finishOwner({initial:{primaryPresent,primary,secondary:completed?.finalState.secondary??[]},captures:[],census:()=>sample(work,536870912),publish(state,captureRows){publish(work+'/capture/OWNER-FINALIZATION.json',Buffer.from(JSON.stringify({state:wire(state),captureRows})+'\n'),started+1500000);}});process[state.primaryPresent?'stderr':'stdout'].write(JSON.stringify({status:state.primaryPresent?'STOP':'COMPLETED',finalization:wire(state)})+'\n');if(state.primaryPresent)process.exitCode=1;}
else{process.stderr.write(JSON.stringify(preauthRecord(primaryPresent,primary))+'\n');process.exitCode=1;}
