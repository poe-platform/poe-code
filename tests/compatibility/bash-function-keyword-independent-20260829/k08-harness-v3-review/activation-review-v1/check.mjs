import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root='/Users/kjopek/Workspace/safe-bash',packet=root+'/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v3',base=packet+'/activation-v1',own=root+'/tests/compatibility/bash-function-keyword-independent-20260829/k08-harness-v3-review/activation-review-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),checks=[];
function read(filename,pin,maximum=262144){const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);if(pin){assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);if(pin.mode!==undefined)assert.equal(stat.mode&4095,pin.mode);}checks.push({path:filename,bytes:bytes.length,sha256:hash(bytes),mode:stat.mode&4095});return bytes;}
async function stream(pin){const stat=fs.lstatSync(pin.path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===pin.bytes);if(pin.mode!==undefined)assert.equal(stat.mode&4095,pin.mode);const digest=crypto.createHash('sha256');let size=0;for await(const bytes of fs.createReadStream(pin.path,{highWaterMark:65536})){size+=bytes.length;assert(size<=pin.bytes);digest.update(bytes);}assert.equal(size,pin.bytes);assert.equal(digest.digest('hex'),pin.sha256);checks.push({path:pin.path,bytes:size,sha256:pin.sha256,mode:stat.mode&4095});}
const author=JSON.parse(read(base+'/PRESEAL.json',{bytes:5934,sha256:'52ca96a129621ada2ba34eccd86b949eb986e74667c5aebe25ba8e21b92f597b'}));
const sealHash='db262c234c02526f2864ef66d8e137e9cd9817645431d944ff3459ad3c89d9d9';
const seal=JSON.parse(read(packet+'/SEAL.json',{bytes:200923,sha256:sealHash}));
assert.equal(seal.sourceCommit,'ffac894aa98b8cd98476b8ea109ef2e2425c2a07');
for(const pin of author.files)read(pin.path,pin);
for(const [name,pin]of Object.entries(seal.files))read(packet+'/'+name,pin);
for(const [name,pin]of Object.entries(seal.helperPins))read(seal.helperRoot+'/'+name,pin);
for(const pin of [author.node,...author.launchTools,seal.archive])await stream(pin);
read(seal.sourceBinding.path,seal.sourceBinding);
const grantBytes=read(packet+'/GO.json',{bytes:976,sha256:'1de03294f35b1c7f9d3d9aee1281250eec3771cfdc6aa2fbcee28a30f213c641',mode:384});
const reviewBytes=read(packet+'/REVIEW.json',{bytes:211,sha256:'80f3ae8ed00a5dcc7ba597497352fcf4e94a21e427e53858b3fe6b8e970653d3',mode:384});
const grant=JSON.parse(grantBytes),review=JSON.parse(reviewBytes);assert.equal(review.independentCommit,'5aa383ae63e20ef8df3fa0bd2c2e06871976fe76');assert.equal(Object.keys(review).length,4);
const command=read(base+'/COMMAND.resolved.txt',{bytes:346,sha256:'7984588d150e52732e87063a045cc657d653463bf6eba765bc944f90eec5321d'}).toString();
assert.equal(command,`exec /bin/zsh -f '${packet}/launch.sh' '200923' '${sealHash}' '${hash(grantBytes)}' '${hash(reviewBytes)}'\n`);
const listing=read(own+'/locator.stdout');assert.equal(listing.at(-1),0);let gitBindings=0;
for(const row of listing.toString().slice(0,-1).split('\0')){const tab=row.indexOf('\t'),metadata=row.slice(0,tab).split(' '),filename=root+'/'+row.slice(tab+1);if(!['PRESEAL.json','COMMAND.resolved.txt','PUBLICATION-COPY-CORRECTION.json','RESULT.json'].some(name=>filename===base+'/'+name))continue;const bytes=read(filename);assert.equal(metadata[1],'blob');assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),metadata[2]);gitBindings++;}assert.equal(gitBindings,4);
const correction=JSON.parse(read(base+'/PUBLICATION-COPY-CORRECTION.json',{bytes:1415,sha256:'840347c6f81e21b3b1873cef1e974a1eba55ebd1b1dff59593648281df3119dc'}));
read(base+'/'+correction.retainedNonAuthoritativeCopy.path,correction.retainedNonAuthoritativeCopy);read(correction.authoritativeCapture.path,correction.authoritativeCapture);read(base+'/'+correction.replacement.path,correction.replacement);
function unused(){for(const filename of author.unusedPaths){let failure;try{fs.lstatSync(filename);}catch(reason){failure=reason;}assert.equal(failure?.code,'ENOENT');}const capture=seal.work+'/future-v3-capture';const stat=fs.lstatSync(capture);assert(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(fs.readdirSync(capture).length,0);assert.equal(fs.realpathSync(seal.work),seal.work);assert.equal(fs.realpathSync(seal.sourceApp),seal.sourceApp);}
unused();const {validateActivation}=await import(pathToFileURL(packet+'/activation.mjs'));const now=Date.now();const validated=validateActivation(grant,review,{preseal:sealHash,work:seal.work,limits:seal.limits,roles:seal.roles,started:now,now});assert.equal(validated.finalDeadline,now+1500000);
assert.equal(grant.issuedAtEpochMs,Date.parse('2026-08-29T16:08:30.357Z'));assert.equal(grant.latestStartEpochMs,Date.parse('2026-08-29T16:28:30.357Z'));assert.equal(grant.expiresEpochMs,Date.parse('2026-08-29T16:53:30.357Z'));
const originalChecks=checks.length;for(const pin of [...checks])await stream(pin);unused();assert(Date.now()<=grant.latestStartEpochMs);
const result={decision:'ACCEPT_FINAL_SLOT_ONLY',utc:new Date().toISOString(),source:'463b17b4df4430555f72b2c358ba94e747fa50b6',qualification:'4989e28151ab3b384871455af0660ec8ac88b5aa',sourceFiles:Object.keys(seal.files).length,inheritedHelpers:Object.keys(seal.helperPins).length,launchTools:author.launchTools,sourceBinding:seal.sourceBinding,originalChecks,postguards:originalChecks,gitBindings,unusedPaths:author.unusedPaths.length,emptyCapture:true,grant:{bytes:976,sha256:hash(grantBytes),mode:'0600'},review:{bytes:211,sha256:hash(reviewBytes),mode:'0600',commit:review.independentCommit},command:{text:command,bytes:346,sha256:hash(Buffer.from(command)),cwd:root,login:false},window:{issued:new Date(grant.issuedAtEpochMs).toISOString(),latest:new Date(grant.latestStartEpochMs).toISOString(),expiry:new Date(grant.expiresEpochMs).toISOString()},copyQualification:'original0B and exact derivative verified; retained1LF copy not raw loss or rescore',actualGo:false,productCalls:0,decodeCalls:0,workers:0};
fs.writeFileSync(own+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({decision:result.decision,utc:result.utc,originalChecks,postguards:originalChecks,unusedPaths:result.unusedPaths}));
