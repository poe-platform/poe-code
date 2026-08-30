import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const packet="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2",root="/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2/activation-v1",hash=raw=>createHash('sha256').update(raw).digest('hex');
function pinned(filename,pin){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes||stat.size>2097152)throw Error('BIND_TYPE_SIZE');const raw=fs.readFileSync(filename);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)throw Error('BIND_HASH');return raw;}
const preseal=JSON.parse(fs.readFileSync(root+'/PRESEAL.json'));if(Date.now()>=preseal.phaseDeadline)throw Error('BIND_DEADLINE');
for(const [filename,pin]of Object.entries(preseal.files))pinned(filename,pin);
const seal=JSON.parse(pinned(packet+'/SEAL.json',preseal.seal));
for(const [name,pin]of Object.entries(seal.files))pinned(packet+'/'+name,pin);
for(const [name,pin]of Object.entries(seal.helperPins))pinned(seal.helperRoot+'/'+name,pin);
const {pinExecutable}=await import(pathToFileURL(packet+'/auth.mjs'));pinExecutable(seal.node);
const source=JSON.parse(pinned(seal.sourceBinding.path,seal.sourceBinding));for(const row of source)pinned(path.join(seal.sourceApp,row.path),row);
for(const row of seal.shipping){pinned(path.join(seal.sourceApp,row.path),row);if((fs.lstatSync(path.join(seal.sourceApp,row.path)).mode&4095)!==row.mode)throw Error('SHIPPING_MODE');}
pinned(seal.archive.path,seal.archive);
const absent=[packet+'/GO.json',packet+'/REVIEW.json',...['auth.mjs','profile.mjs','guard.mjs','case-driver.mjs','helper-driver.mjs','case-adapter.mjs','CASES.json'].map(name=>seal.sourceApp+'/'+name),...['target-installed','target-moved','target-mutant-M01','target-mutant-M02','target-mutant-M03'].map(name=>seal.work+'/'+name)];
for(const filename of absent){try{fs.lstatSync(filename);throw Error('CONSUMED_PATH:'+filename);}catch(reason){if(reason.code!=='ENOENT')throw reason;}}
const captureStat=fs.lstatSync(seal.work+'/future-capture');if(!captureStat.isDirectory()||captureStat.isSymbolicLink()||fs.readdirSync(seal.work+'/future-capture').length)throw Error('CONSUMED_CAPTURE');
if(fs.realpathSync(seal.work)!==seal.work||fs.realpathSync(seal.sourceApp)!==seal.sourceApp)throw Error('NONCANONICAL');
const grant=JSON.parse(pinned(packet+'/GO.template.json',preseal.files[packet+'/GO.template.json'])),review=JSON.parse(pinned(packet+'/REVIEW.template.json',preseal.files[packet+'/REVIEW.template.json']));
const issued=Date.now();grant.decision='GO';grant.issuedAtEpochMs=issued;grant.latestStartEpochMs=issued+1200000;grant.expiresEpochMs=issued+2700000;review.decision='ACCEPT';review.independentCommit=preseal.independentCommit;
const {validateActivation}=await import(pathToFileURL(packet+'/activation.mjs'));const validated=validateActivation(grant,review,{preseal:preseal.seal.sha256,work:seal.work,limits:seal.limits,roles:seal.roles,started:issued,now:Date.now()});
const grantRaw=Buffer.from(JSON.stringify(grant,null,2)+String.fromCharCode(10)),reviewRaw=Buffer.from(JSON.stringify(review,null,2)+String.fromCharCode(10));
const command=fs.readFileSync(packet+'/COMMAND.pending.txt','utf8').replace('ROOT_APPROVED_GRANT_SHA256',hash(grantRaw)).replace('INDEPENDENT_REVIEW_SHA256',hash(reviewRaw));
if(command.includes('ROOT_APPROVED')||command.includes('INDEPENDENT_REVIEW'))throw Error('UNRESOLVED_SLOT');
if(Date.now()>=preseal.phaseDeadline)throw Error('BIND_DEADLINE');
process.stdout.write(JSON.stringify({schema:'k08-binding-proposal-v1',status:'BINDING_VALIDATED_NOT_ACTIVATED',grant:{bytes:grantRaw.length,sha256:hash(grantRaw),base64:grantRaw.toString('base64')},review:{bytes:reviewRaw.length,sha256:hash(reviewRaw),base64:reviewRaw.toString('base64')},command:{bytes:Buffer.byteLength(command),sha256:hash(Buffer.from(command)),text:command},utc:{issuedAt:new Date(issued).toISOString(),latestStart:new Date(grant.latestStartEpochMs).toISOString(),expiresAt:new Date(grant.expiresEpochMs).toISOString()},validated,sourceInputs:source.length,shippingMembers:seal.shipping.length,consumedPathsAbsent:absent,futureCaptureEmpty:true,knownHelperChildren:0,actualProductCalls:0})+String.fromCharCode(10));
