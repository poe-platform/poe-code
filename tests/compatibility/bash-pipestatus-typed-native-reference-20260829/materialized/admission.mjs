import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export const startupScope='INITIAL_TOOL_SHELL_TRUSTED_HOST_OUTSIDE_CHILD_FRESH_ENV_AND_OWNED_RAW_CAPTURE';
export function validateStartupScope(value){requireValue(value===startupScope,'STARTUP_SCOPE');return true;}
export function exactKeys(value,keys){
 requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value),'OBJECT');
 const actual=Reflect.ownKeys(value);requireValue(actual.length===keys.length&&actual.every((key,index)=>key===keys[index]),'KEYS');
 for(const key of keys){const property=Object.getOwnPropertyDescriptor(value,key);requireValue(property&&Object.hasOwn(property,'value'),'DATA_PROPERTY');}
 return true;
}
function metadata(stat,pin,maximum){requireValue(stat.isFile()&&stat.nlink===1&&Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&stat.size===pin.bytes&&stat.size<=maximum&&Number.isSafeInteger(pin.mode)&&(stat.mode&511)===pin.mode&&hex(pin.sha256),'PIN_METADATA');}
export function pinned(filename,pin,{maximum=134217728}={}){
 requireValue(path.isAbsolute(filename)&&fs.realpathSync(filename)===filename,'PIN_PATH');
 const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(descriptor);metadata(before,pin,maximum);const digest=createHash('sha256'),buffer=Buffer.alloc(Math.min(1048576,Math.max(1,before.size)));let total=0,count;while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){total+=count;requireValue(total<=before.size,'PIN_GROWTH');digest.update(buffer.subarray(0,count));}requireValue(total===before.size&&digest.digest('hex')===pin.sha256,'PIN_HASH');const after=fs.fstatSync(descriptor);requireValue(after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'PIN_RACE');}finally{fs.closeSync(descriptor);}return true;
}
export function small(filename,pin){
 requireValue(path.isAbsolute(filename)&&fs.realpathSync(filename)===filename,'PIN_PATH');const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const before=fs.fstatSync(descriptor);metadata(before,pin,1048576);const bytes=fs.readFileSync(descriptor),after=fs.fstatSync(descriptor);requireValue(bytes.length===before.size&&hash(bytes)===pin.sha256&&after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'PIN_BYTES_OR_RACE');return bytes;}finally{fs.closeSync(descriptor);}
}
export function validateReview(receipt,expected){
 exactKeys(receipt,['schema','decision','profile','presealSha256','requestsSha256','reviewer','reviewCommit']);
 requireValue(receipt.schema==='pipestatus-typed-independent-acceptance-v1'&&receipt.decision==='ACCEPT'&&receipt.profile==='pipestatus-typed-reference-v1'&&hex(receipt.presealSha256)&&hex(receipt.requestsSha256)&&receipt.presealSha256===expected.presealSha256&&receipt.requestsSha256===expected.requestsSha256&&typeof receipt.reviewer==='string'&&receipt.reviewer.length>0&&receipt.reviewer.length<=128&&typeof receipt.reviewCommit==='string'&&/^[0-9a-f]{40}$/.test(receipt.reviewCommit),'REVIEW_CONTENT');return true;
}
export function validateGrant(grant,now){
 exactKeys(grant,['schema','decision','profile','issuedEpochMs','deadlineEpochMs','startupScope','preseal','independentReviewReceipt','preprovision','limits','failedLookupNames']);
 requireValue(grant.schema==='pipestatus-typed-root-grant-v1'&&grant.decision==='GO'&&grant.profile==='pipestatus-typed-reference-v1'&&Number.isSafeInteger(grant.issuedEpochMs)&&grant.issuedEpochMs<=now&&Number.isSafeInteger(grant.deadlineEpochMs)&&grant.deadlineEpochMs-grant.issuedEpochMs===2700000&&now+600000<=grant.deadlineEpochMs&&JSON.stringify(grant.failedLookupNames)===JSON.stringify([]),'GRANT_CONTENT');validateStartupScope(grant.startupScope);return true;
}
export function validateManifest(seal){
 requireValue(seal.schema==='pipestatus-typed-executable-preseal-v1'&&Array.isArray(seal.files)&&seal.files.length>9&&seal.files.length<=64,'SEAL');
 const names=new Set();for(const item of seal.files){requireValue(typeof item.path==='string'&&/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(item.path)&&!item.path.split('/').some(part=>part==='.'||part==='..')&&!names.has(item.path),'SEAL_PATH');names.add(item.path);}
 for(const name of ['entry.mjs','admission.mjs','capture.mjs','lifecycle.mjs','group-observer.mjs','observer-state.mjs','state.mjs','storage.mjs','observation.mjs','REQUESTS.json','COHORT.json','PROTOCOL.json','TOOLS.json'])requireValue(names.has(name),'SEAL_MEMBER');
 for(const name of ['GO.json','REVIEW-ACCEPTANCE.json','PREPROVISION.json','PRESEAL.json'])requireValue(!names.has(name),'SEAL_CYCLE');
 return true;
}
export function validateCohort(audit,requests,root){
 const ids=['P19','P20','P21','P22','P23','P24'];
 const forks={P22:2,P23:2};
 requireValue(Array.isArray(audit.cases)&&audit.cases.length===6&&Array.isArray(requests)&&requests.length===6&&Array.isArray(audit.fixtures)&&audit.fixtures.length===0,'EXACT6');
 for(let index=0;index<6;index++){
  const literal=audit.cases[index],request=requests[index],id=ids[index],caseRoot=root+'/cases/'+id;
  requireValue(literal.id===id&&request.id===id,'ID');
  requireValue(typeof literal.program==='string'&&hash(Buffer.from(literal.program))===literal.programSha256&&JSON.stringify(request.argv)===JSON.stringify(['--noprofile','--norc','-c',literal.program,'pipestatus-typed-case'])&&request.executable==='/bin/bash','LITERAL_BINDING');
  requireValue(literal.stdinBase64===''&&request.stdinBase64===''&&request.cwd===caseRoot+'/work'&&request.extraProcessReservation===(forks[id]??0),'REQUEST_BINDING');
  const expected={LC_ALL:'C',LANG:'C',TZ:'UTC',HOME:caseRoot+'/home',TMPDIR:caseRoot+'/tmp',PATH:caseRoot+'/empty-path'};exactKeys(request.environment,Object.keys(expected));requireValue(JSON.stringify(request.environment)===JSON.stringify(expected),'ENVIRONMENT_BINDING');
 }
 return true;
}
export function validateOuter(root,name,fd,operations=fs){
 requireValue((name==='stdout'&&fd===1)||(name==='stderr'&&fd===2),'OUTER_ROLE');
 const filename=root+'/outer/bootstrap.'+name,stat=operations.fstatSync(fd),named=operations.lstatSync(filename);
 requireValue(stat.isFile()&&named.isFile()&&!named.isSymbolicLink()&&stat.ino===named.ino&&stat.dev===named.dev&&stat.nlink===1&&(stat.mode&511)===384&&operations.realpathSync(filename)===filename,'OUTER_FD_BINDING');
 operations.readSync(fd,Buffer.alloc(1),0,1,0);operations.writeSync(fd,Buffer.alloc(0),0,0,0);
 return {name,fd,ino:stat.ino,path:filename};
}
export function validateProvision(provision,root,operations=fs){
 exactKeys(provision,['parents']);const expected=[root,root+'/outer',root+'/cases',root+'/captures'];requireValue(Array.isArray(provision.parents)&&provision.parents.length===4,'PROVISION_MEMBERSHIP');
 for(let index=0;index<4;index++){const parent=provision.parents[index];exactKeys(parent,['path','device','inode','mode']);requireValue(parent.path===expected[index]&&typeof parent.device==='string'&&/^\d+$/.test(parent.device)&&typeof parent.inode==='string'&&/^\d+$/.test(parent.inode)&&parent.mode===448,'PROVISION_ROLE');const stat=operations.lstatSync(parent.path,{bigint:true});requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&String(stat.dev)===parent.device&&String(stat.ino)===parent.inode&&Number(stat.mode&511n)===parent.mode&&operations.realpathSync(parent.path)===parent.path,'PREPROVISION_DRIFT');}
 return true;
}
export function admit(directory,grantPath,grantSha256){
 requireValue(grantPath===directory+'/GO.json'&&hex(grantSha256),'GRANT_PATH_OR_HASH');const stat=fs.lstatSync(grantPath),grantRaw=small(grantPath,{mode:384,bytes:stat.size,sha256:grantSha256}),grant=JSON.parse(grantRaw);validateGrant(grant,Date.now());
 const sealRaw=small(directory+'/PRESEAL.json',grant.preseal),seal=JSON.parse(sealRaw);validateManifest(seal);for(const item of seal.files)pinned(directory+'/'+item.path,item,{maximum:1048576});
 const requestsRaw=small(directory+'/REQUESTS.json',seal.files.find(item=>item.path==='REQUESTS.json'));
 const reviewPin=grant.independentReviewReceipt;requireValue(reviewPin&&reviewPin.path===directory+'/REVIEW-ACCEPTANCE.json'&&reviewPin.mode===384&&Number.isSafeInteger(reviewPin.bytes)&&reviewPin.bytes>0&&reviewPin.bytes<=65536&&hex(reviewPin.sha256),'REVIEW_PIN');
 const review=JSON.parse(small(reviewPin.path,reviewPin));validateReview(review,{presealSha256:hash(sealRaw),requestsSha256:hash(requestsRaw)});
 const provisionPin=grant.preprovision;requireValue(provisionPin&&provisionPin.path===directory+'/PREPROVISION.json'&&provisionPin.mode===384&&Number.isSafeInteger(provisionPin.bytes)&&provisionPin.bytes>0&&provisionPin.bytes<=65536&&hex(provisionPin.sha256),'PROVISION_PIN');
 const provision=JSON.parse(small(provisionPin.path,provisionPin));return {grant,seal,review,provision,requests:JSON.parse(requestsRaw)};
}
export function resolveApproval(template,resolved,grantSha256){
 requireValue(hex(grantSha256),'GRANT_SHA');const token='ROOT_APPROVED_GRANT_SHA256';requireValue(template.parameters.cmd.split(token).length===2,'SLOT_COUNT');
 const expected=structuredClone(template.parameters);expected.cmd=expected.cmd.replace(token,grantSha256);
 exactKeys(resolved,Object.keys(expected));requireValue(JSON.stringify(resolved)===JSON.stringify(expected)&&resolved.login===false&&resolved.sandbox_permissions==='require_escalated'&&!Object.hasOwn(resolved,'prefix_rule'),'APPROVAL_DRIFT');return true;
}
