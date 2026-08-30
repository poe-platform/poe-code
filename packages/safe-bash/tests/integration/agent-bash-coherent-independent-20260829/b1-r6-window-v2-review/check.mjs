import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2],input=root+'/inputs/';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function auth(entry) {
  const stat=fs.lstatSync(entry.path);assert(stat.isFile());assert.equal(stat.size,entry.bytes);
  const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(65536),fd=fs.openSync(entry.path,'r');let count=0;
  try{for(;;){const size=fs.readSync(fd,buffer,0,buffer.length,null);if(!size)break;count+=size;digest.update(buffer.subarray(0,size));}}finally{fs.closeSync(fd);}
  assert.equal(count,entry.bytes);assert.equal(digest.digest('hex'),entry.sha256,entry.path);
}
const finalBytes=fs.readFileSync(input+'FINAL.json');
assert.equal(finalBytes.length,25661);assert.equal(hash(finalBytes),'89f3c55c91dc664a94df815ef23d5ddbbe6fb7376a1ef5a8e490255c475dd72b');
const final=JSON.parse(finalBytes),command=JSON.parse(fs.readFileSync(input+'COMMAND.json'));
auth(final.previousConsumedAttempt.final);
const previous=JSON.parse(fs.readFileSync(final.previousConsumedAttempt.final.path));
const unchanged=['schema','repo','maxKnownOS','peak','action','actualAuthority','sourceTree','sourceInputs','package','members','actualStageAEmissions','adminRoot','runtimeRoot','publicationRoot','captureRoot','metadataHome','adminOwner','ownerKernel','dispatch','preimportEntry','adminFiles','preimportFiles','publisherFiles','runtimePreseal','runtimeInputFiles','tools','absentSlots','slots','runtimeCommand','preimportCommand','runtimeRoles','limits','dynamic','qualifications','prospectiveAuthorization','retiredUnusedWindow'];
for(const field of unchanged)assert.deepEqual(final[field],previous[field],field);
const allowed=new Set(['issuedUTC','latestStartUTC','expiresUTC','publisherBinding','publisherPreseal','publicationCommand','revision','previousConsumedAttempt','reviewQualifications','reviewBindings','bindingOnly','outerCaptureSlots']);
for(const field of new Set([...Object.keys(final),...Object.keys(previous)]))if(!allowed.has(field))assert.deepEqual(final[field],previous[field],field);
for(const field of Object.keys(previous.reviewBindings))if(field!=='finalReview')assert.deepEqual(final.reviewBindings[field],previous.reviewBindings[field]);
const before=[];
function absent(path){try{fs.lstatSync(path);throw Error('SLOT_OCCUPIED '+path);}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const path of [...final.absentSlots,...final.outerCaptureSlots]){absent(path);before.push(path);}
const entries=[...final.adminFiles,...final.preimportFiles,...final.publisherFiles,...final.runtimeInputFiles,...final.tools,final.runtimePreseal,final.publisherBinding,final.publisherPreseal,final.package,command.launch];
const seen=new Map();for(const entry of entries){if(seen.has(entry.path)){assert.deepEqual(entry,seen.get(entry.path));continue;}auth(entry);seen.set(entry.path,entry);}
auth(previous.publisherBinding);auth(previous.publisherPreseal);
const publication=JSON.parse(fs.readFileSync(final.publisherBinding.path)),oldPub=JSON.parse(fs.readFileSync(previous.publisherBinding.path));
const restored=structuredClone(publication);
for(let index=0;index<2;index++){assert.equal(publication.outputs.startupCaptures[index],final.outerCaptureSlots[index]);assert.equal(publication.startupStreams[index].path,final.outerCaptureSlots[index]);restored.outputs.startupCaptures[index]=oldPub.outputs.startupCaptures[index];restored.startupStreams[index].path=oldPub.startupStreams[index].path;}
assert.deepEqual(restored,oldPub,'publisher changes only two capture paths');
const pubCommand=structuredClone(final.publicationCommand);for(const index of [2,3,4])pubCommand.argv[index]=previous.publicationCommand.argv[index];assert.deepEqual(pubCommand,previous.publicationCommand);
assert.equal(command.executable,'/bin/zsh');assert.equal(command.login,false);assert.equal(command.cwd,final.repo);assert.equal(command.actualGo,false);
assert.deepEqual(command.env,{B1_ADMIN_ROOT_GO:'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION'});
assert.equal(command.argv[1],'/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/FINAL.json');assert.equal(command.argv[2],hash(finalBytes));assert.equal(command.argv[3],'25661');assert.equal(command.argv[4],final.prospectiveAuthorization);
const launch=fs.readFileSync(command.launch.path,'utf8');assert(launch.startsWith('set -euC\n'));assert(launch.includes('exec > '+final.outerCaptureSlots[0]+' 2> '+final.outerCaptureSlots[1]));assert(launch.includes(final.adminOwner.path));
const now=Date.now(),issued=Date.parse(final.issuedUTC),latest=Date.parse(final.latestStartUTC),expiry=Date.parse(final.expiresUTC);
for(const [text,time] of [[final.issuedUTC,issued],[final.latestStartUTC,latest],[final.expiresUTC,expiry]])assert.equal(new Date(time).toISOString(),text);
assert.equal(latest-issued,1200000);assert.equal(expiry-latest,1800000);assert(now>=issued&&now<=latest&&now+1800000<=expiry);
assert.equal(final.maxKnownOS,36);assert.equal(final.peak,3);assert.equal(final.limits.inclusiveSeconds,1800);assert.equal(final.limits.activeSeconds+final.limits.publicationReserveSeconds,1800);assert.equal(final.limits.captureBytes,67108864);assert.equal(final.limits.logicalWorkBytes,805306368);assert.equal(final.limits.guestTotal,15);assert.equal(final.limits.guestLive,5);assert.equal(final.limits.regexWorkers,0);assert.equal(final.limits.asyncLoaderThreads,0);
for(const path of before)absent(path);
for(const entry of seen.values())auth(entry);
const shellCommand='B1_ADMIN_ROOT_GO=ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION /bin/zsh '+command.argv.map(value=>"'"+value.replaceAll("'","'\\''")+"'").join(' ');
const result={decision:'ACCEPT_FRESH_BINDING_ONLY',checkedUTC:new Date(now).toISOString(),finishedUTC:new Date().toISOString(),checks:4,consumedPins:seen.size,postguards:seen.size,slotsBeforeAfter:before,unchangedFields:unchanged,final:{bytes:finalBytes.length,sha256:hash(finalBytes)},command:shellCommand,commandSha256:hash(Buffer.from(shellCommand)),commandHashDomain:'UTF8 exact command without trailing newline',window:{issuedUTC:final.issuedUTC,latestStartUTC:final.latestStartUTC,expiresUTC:final.expiresUTC},caps:{knownOS:36,peak:3,...final.limits},runtimeRoles:final.runtimeRoles,actualAuthority:false};
fs.writeFileSync(root+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify(result)+'\n');
