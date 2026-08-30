import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='/Users/kjopek/Workspace/safe-bash',base=root+'/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v3',own=root+'/tests/compatibility/bash-function-keyword-independent-20260829/k08-harness-v3-review';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),bindings=[];
function read(filename,pin){const stat=fs.lstatSync(filename);assert(stat.isFile()&&stat.size<=262144);const bytes=fs.readFileSync(filename);if(pin){assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes),pin.sha256);}bindings.push({path:filename,bytes:bytes.length,sha256:hash(bytes),mode:stat.mode&511});return bytes;}
const seal=JSON.parse(read(base+'/SEAL.json',{bytes:200923,sha256:'db262c234c02526f2864ef66d8e137e9cd9817645431d944ff3459ad3c89d9d9'}));
const controls=JSON.parse(read(base+'/CONTROL-PRESEAL-v2.json'));
const inventory=read(own+'/locator.stdout');assert.equal(inventory.at(-1),0);
const git=new Map(inventory.toString().slice(0,-1).split('\0').map(row=>{const tab=row.indexOf('\t');return[row.slice(tab+1),row.slice(0,tab).split(' ')[2]];}));
fs.mkdirSync(own+'/snapshot');const files=[];
const entries=new Map(Object.entries({...seal.files,...controls.files}));
for(const name of ['SEAL.json','CONTROL-PRESEAL-v2.json','UNUSED-ROOTS.json','GO.template.json','REVIEW.template.json','COMMAND.pending.txt','DELTA-DIAGNOSIS.json'])if(!entries.has(name))entries.set(name,null);
for(const [name,pin]of entries){const bytes=read(base+'/'+name,pin),oid=git.get((base+'/'+name).slice(root.length+1));assert(oid);assert.equal(crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),oid);fs.writeFileSync(own+'/snapshot/'+name,bytes,{flag:'wx'});files.push({path:'snapshot/'+name,bytes:bytes.length,sha256:hash(bytes)});}
for(const [name,pin]of Object.entries(seal.helperPins))read(seal.helperRoot+'/'+name,pin);
for(const pin of [seal.node,seal.archive]){const stat=fs.lstatSync(pin.path);assert(stat.isFile()&&stat.size===pin.bytes);const digest=crypto.createHash('sha256');let size=0;for await(const bytes of fs.createReadStream(pin.path,{highWaterMark:65536})){size+=bytes.length;assert(size<=pin.bytes);digest.update(bytes);}assert.equal(digest.digest('hex'),pin.sha256);bindings.push({...pin,mode:stat.mode&511});}
const old=JSON.parse(read(root+'/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2/SEAL.json'));
const preserved=['auth.mjs','direct-child.mjs','collector-core.mjs','preauth.mjs','helper-driver.mjs','case-adapter.mjs','case-driver.mjs','qualification.mjs','CASES.json','M01-DISCRIMINATOR.json','PRODUCT-EDGES.json'];
for(const name of preserved)assert.deepEqual(seal.files[name],old.files[name]);
assert.deepEqual(seal.archive,old.archive);assert.equal(seal.sourceCommit,old.sourceCommit);assert.equal(seal.sourceApp,old.sourceApp);assert.equal(seal.helperPins['finalization.mjs'].sha256,old.helperPins['finalization.mjs'].sha256);
const owner=read(base+'/target-owner.mjs').toString();assert(owner.includes("await import('./owner-archive.mjs')"));assert(owner.indexOf('await admitOwnerArchive(seal)')>=0);assert(owner.indexOf('await admitOwnerArchive(seal)')<owner.indexOf('extract(tarBuffer'));
const absent=[base+'/GO.json',base+'/REVIEW.json',...['target-v3-installed','target-v3-moved','target-v3-mutant-M01','target-v3-mutant-M02','target-v3-mutant-M03'].map(name=>seal.work+'/'+name)];
for(const filename of absent){let error;try{fs.lstatSync(filename);}catch(reason){error=reason;}assert.equal(error?.code,'ENOENT');}
const capture=seal.work+'/future-v3-capture';assert(fs.lstatSync(capture).isDirectory());assert.equal(fs.readdirSync(capture).length,0);assert.equal(fs.realpathSync(seal.work),seal.work);assert.equal(fs.realpathSync(seal.sourceApp),seal.sourceApp);
const helper=read(own+'/check.mjs');files.push({path:'check.mjs',bytes:helper.length,sha256:hash(helper)});
fs.writeFileSync(own+'/BINDINGS.json',JSON.stringify({bindings,preserved,absent,capture,ownerAdmissionBeforeExtraction:true},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(own+'/PRESEAL.json',JSON.stringify({utc:new Date().toISOString(),source:'6dfff45db6b24d0118721a905ca7f7a058a7c3ec',files,helperStarts:1,authorGroups:8,novelGroups:['N01-count-versus-alignment','N02-duplicate-after-complete-set','N03-aligned-missing-payload'],scope:'Archive DATA admission/decode only; no extraction/product/native',budget:{seconds:360,knownOs:20,peak:3,capture:33554432,work:134217728}},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({bindings:bindings.length,files:files.length,utc:new Date().toISOString()}));
