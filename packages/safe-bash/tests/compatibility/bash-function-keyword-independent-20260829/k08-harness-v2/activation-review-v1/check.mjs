import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const root='/Users/kjopek/Workspace/safe-bash';
const packet=root+'/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2';
const own=root+'/tests/compatibility/bash-function-keyword-independent-20260829/k08-harness-v2/activation-review-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const checked=[];
function read(filename,pin,maximum=262144){
  const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);
  const bytes=fs.readFileSync(filename);assert.equal(bytes.length,stat.size);
  if(pin){assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);}
  checked.push({path:filename,bytes:bytes.length,sha256:hash(bytes),mode:stat.mode&4095});return bytes;
}
async function streamed(filename,pin){
  const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,pin.bytes);
  if(pin.mode!==undefined)assert.equal(stat.mode&4095,pin.mode);
  const digest=crypto.createHash('sha256');let size=0;
  for await(const bytes of fs.createReadStream(filename,{highWaterMark:65536})){size+=bytes.length;assert(size<=pin.bytes);digest.update(bytes);}
  assert.equal(size,pin.bytes);assert.equal(digest.digest('hex'),pin.sha256);
  checked.push({path:filename,bytes:size,sha256:pin.sha256,mode:stat.mode&4095});
}
const sealHash='430e9024238b1e4bf90c5aa61e20a18d8b001ca01abbf3cac2acaaed68c2df49';
const seal=JSON.parse(read(packet+'/SEAL.json',{bytes:199449,sha256:sealHash}));
assert.equal(seal.sourceCommit,'ffac894aa98b8cd98476b8ea109ef2e2425c2a07');
const bindingRaw=read(packet+'/activation-v1/BINDING-RECEIPT.json',{bytes:2296,sha256:'f703efa77da99540cd68c8fab29493b147d3354900ce70c50365d899deddf867'});
const binding=JSON.parse(bindingRaw);
for(const row of binding.files){read(row.path,row);assert.equal(fs.lstatSync(row.path).mode&4095,row.mode);}
const grantBytes=read(packet+'/GO.json',{bytes:976,sha256:'5faba4fe944420c29637b0d9d643c24555cc6be05638134d90910f6d59a2891b'});
const reviewBytes=read(packet+'/REVIEW.json',{bytes:211,sha256:'19b53c9dcc8c9eaa5b3f63b4b5599cdbcaa3e79d5ca24a587371aeaa7e50a684'});
const grant=JSON.parse(grantBytes),review=JSON.parse(reviewBytes);
assert.equal(review.independentCommit,'29b6f0d5696e920cf42dbaac120b05e675e6b03f');assert.equal(Object.keys(review).length,4);
read(own+'/../RECEIPT.json',{bytes:5096,sha256:'bd5c3e5bddc871a929d510c734d95c1f5ac6d62ec5eb84e84be5e40ad23b5690'});
const command=read(packet+'/activation-v1/COMMAND.resolved.txt',{bytes:346,sha256:'e48cfe86594ed6f3fd56e6add6f3a839770d9e190f45135de77342bd0fe803d9'});
assert.equal(command.toString(),`exec /bin/zsh -f '${packet}/launch.sh' '199449' '${sealHash}' '${hash(grantBytes)}' '${hash(reviewBytes)}'\n`);
const listing=read(own+'/locator.stdout');assert.equal(listing.at(-1),0);let bound=0;
for(const record of listing.toString().slice(0,-1).split('\0')){
  const tab=record.indexOf('\t'),parts=record.slice(0,tab).split(' '),filename=root+'/'+record.slice(tab+1);
  if(!['BINDING-RECEIPT.json','COMMAND.resolved.txt','HANDOFF.md','PRESEAL.json'].some(name=>filename===packet+'/activation-v1/'+name))continue;
  const bytes=read(filename);assert.equal(parts[1],'blob');assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),parts[2]);bound++;
}
assert.equal(bound,4);
for(const [name,pin]of Object.entries(seal.files))read(packet+'/'+name,pin);
for(const [name,pin]of Object.entries(seal.helperPins))read(seal.helperRoot+'/'+name,pin);
const source=JSON.parse(read(seal.sourceBinding.path,seal.sourceBinding));assert.equal(source.length,306);
assert.equal(seal.shipping.length,1006);
for(const row of source)await streamed(seal.sourceApp+'/'+row.path,row);
for(const row of seal.shipping)await streamed(seal.sourceApp+'/'+row.path,row);
await streamed(seal.archive.path,seal.archive);await streamed(seal.node.path,seal.node);
assert.equal(seal.archive.sha256,'0b6ae3340691c1c91b26f40454b8095d2ed346389353aa93e9a43c64d5a1132c');
const unused=[...['auth.mjs','profile.mjs','guard.mjs','case-driver.mjs','helper-driver.mjs','case-adapter.mjs','CASES.json'].map(name=>seal.sourceApp+'/'+name),...['target-installed','target-moved','target-mutant-M01','target-mutant-M02','target-mutant-M03'].map(name=>seal.work+'/'+name)];
function absent(){for(const filename of unused){let failure;try{fs.lstatSync(filename);}catch(error){failure=error;}assert.equal(failure?.code,'ENOENT');}assert.equal(fs.readdirSync(seal.work+'/future-capture').length,0);assert.equal(fs.realpathSync(seal.work),seal.work);assert.equal(fs.realpathSync(seal.sourceApp),seal.sourceApp);}
absent();
const {validateActivation}=await import(pathToFileURL(packet+'/activation.mjs'));
const now=Date.now();const validation=validateActivation(grant,review,{preseal:sealHash,work:seal.work,limits:seal.limits,roles:seal.roles,started:now,now});
assert.equal(validation.finalDeadline,now+1500000);assert.equal(grant.latestStartEpochMs,Date.parse('2026-08-29T15:53:29.112Z'));assert.equal(grant.expiresEpochMs,Date.parse('2026-08-29T16:18:29.112Z'));
for(const row of [...checked])await streamed(row.path,row);
absent();assert(Date.now()<=grant.latestStartEpochMs);
const result={decision:'ACCEPT_FINAL_SLOT_ONLY',utc:new Date().toISOString(),harnessBinding:'b52b2ef61a5ea3cc97be80ef338e02a9444fde85',sourceInputs:306,shippingMembers:1006,packetFiles:15,inheritedHelpers:9,gitBindings:bound,originalChecks:checked.length/2,postguards:checked.length/2,grant:{bytes:976,mode:'0600',sha256:hash(grantBytes)},review:{bytes:211,mode:'0600',sha256:hash(reviewBytes),commit:review.independentCommit},command:{bytes:346,sha256:hash(command),text:command.toString(),cwd:root,login:false},window:{issued:new Date(grant.issuedAtEpochMs).toISOString(),latest:new Date(grant.latestStartEpochMs).toISOString(),expiry:new Date(grant.expiresEpochMs).toISOString()},hypotheticalValidation:validation,unusedPaths:unused,futureCaptureEmpty:true,limits:seal.limits,roles:seal.roles,actualGo:false,productCalls:0,workers:0};
fs.writeFileSync(own+'/RESULT.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({decision:result.decision,utc:result.utc,sourceInputs:306,shippingMembers:1006,originalChecks:result.originalChecks,postguards:result.postguards,actualGo:false}));
