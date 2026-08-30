import fs from 'node:fs';
import {createHash} from 'node:crypto';
const packet="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v2",work="/private/tmp/safe-bash-b35-preexec-v2-GpST8Q/future",started=Date.now();
const captures=[];let primaryPresent=false,primary,completed,finishOwner,publish,sample,wire;
try{
 for(const name of ['owner.stdout','owner.stderr'])captures.push({path:work+'/capture/'+name,fd:fs.openSync(work+'/capture/'+name,'wx+',0o600)});
 const admit=(name,expected)=>{const filename=packet+'/'+name,stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8388608)throw Error('OUTER_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('OUTER_HASH');return bytes;};
 const seal=JSON.parse(admit('PRESEAL.json',process.env.B35_PRESEAL_SHA256));
 for(const [name,pin]of Object.entries(seal.files)){const bytes=admit(name,pin.sha256);if(bytes.length!==pin.bytes)throw Error('OUTER_SIZE');}
 ({finishOwner,wire}=await import('./owner-finalization.mjs'));({publish}=await import('./auth.mjs'));({sample}=await import('./package.mjs'));
 const grant=JSON.parse(admit('GO.json',process.env.B35_GRANT_SHA256)),review=JSON.parse(admit('REVIEW.json',process.env.B35_REVIEW_SHA256));
 if(grant.decision!=='GO'||review.decision!=='ACCEPT'||grant.preseal!==process.env.B35_PRESEAL_SHA256||review.preseal!==grant.preseal||grant.work!==work||grant.calls!==54||Date.now()>grant.latestStartEpochMs||grant.expiresEpochMs-started<1500000)throw Error('ACTIVATION_PENDING_OR_EXPIRED');
 const {run}=await import('./supervisor.mjs');completed=await run(packet,{...seal,activationDeadline:grant.expiresEpochMs},started);primaryPresent=completed.finalState.primaryPresent;primary=completed.finalState.primary;fs.writeFileSync(captures[0].fd,JSON.stringify({status:completed.result.status,finalization:wire(completed.finalState)})+'\n');
}catch(reason){primaryPresent=true;primary=reason;}
if(finishOwner){const state=finishOwner({initial:{primaryPresent,primary,secondary:completed?.finalState.secondary??[]},captures,census:()=>sample(work,536870912),publish(state,captureRows){publish(work+'/capture/OWNER-FINALIZATION.json',Buffer.from(JSON.stringify({state:wire(state),captureRows})+'\n'),started+1500000);}});if(state.primaryPresent){process.stderr.write(JSON.stringify({status:'STOP',finalization:wire(state),captureRows:state.captureRows})+'\n');process.exitCode=1;}else process.stdout.write('B35_AUTHOR_V2_COMPLETED\n');}
else{const secondary=[];for(const capture of captures){for(const action of ['fsyncSync','closeSync'])try{fs[action](capture.fd);}catch(reason){secondary.push({phase:action,present:true,kind:reason===null?'null':typeof reason,message:reason?.message});}}process.stderr.write(JSON.stringify({status:'PREAUTH_STOP',primaryPresent,kind:primary===null?'null':typeof primary,message:primary?.message,secondary})+'\n');process.exitCode=1;}
