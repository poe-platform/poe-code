import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const own=fileURLToPath(new URL('.',import.meta.url));const packet=fileURLToPath(new URL('../',import.meta.url));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const raw=fs.readFileSync(own+'PRESEAL.json');assert.equal(hash(raw),process.argv[2]);const pre=JSON.parse(raw);
for(const pin of pre.files){const stat=fs.lstatSync(pin.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,pin.bytes);if(pin.mode!==undefined)assert.equal(stat.mode&4095,pin.mode);assert.equal(hash(fs.readFileSync(pin.path)),pin.sha256);}
const {readPinned,pinExecutable}=await import('../auth.mjs');const {validateActivation}=await import('../activation.mjs');
const seal=JSON.parse(readPinned(packet+'SEAL.json',pre.seal));
for(const [name,pin]of Object.entries(seal.files))readPinned(packet+name,pin);
for(const [name,pin]of Object.entries(seal.helperPins))readPinned(seal.helperRoot+'/'+name,pin);
pinExecutable(seal.node);for(const pin of pre.launchTools)pinExecutable(pin);
const archive=readPinned(seal.archive.path,seal.archive,2097152);readPinned(seal.sourceBinding.path,seal.sourceBinding,100000);
const grant=JSON.parse(fs.readFileSync(packet+'GO.json')),review=JSON.parse(fs.readFileSync(packet+'REVIEW.json'));
assert.deepEqual(Object.keys(review),['decision','preseal','scope','independentCommit']);assert.equal(review.independentCommit,'5aa383ae63e20ef8df3fa0bd2c2e06871976fe76');
assert.equal(grant.latestStartEpochMs-grant.issuedAtEpochMs,1200000);assert.equal(grant.expiresEpochMs-grant.issuedAtEpochMs,2700000);
const now=Date.now();const admitted=validateActivation(grant,review,{preseal:pre.seal.sha256,work:seal.work,limits:seal.limits,roles:seal.roles,started:now,now});
assert.equal(admitted.duration,1500000);assert.equal(grant.calls,71);assert.equal(grant.roles.primaryCases,69);assert.equal(grant.roles.maximumAllKnownStarts,86);
for(const path of pre.unusedPaths){let absent=false;try{fs.lstatSync(path);}catch(reason){if(reason.code==='ENOENT')absent=true;else throw reason;}assert.ok(absent,path);}
const capture=fs.lstatSync(pre.capture.path);assert.ok(capture.isDirectory()&&!capture.isSymbolicLink());assert.equal(capture.mode&4095,448);assert.deepEqual(fs.readdirSync(pre.capture.path),[]);
const command=fs.readFileSync(own+'COMMAND.resolved.txt');const expected=fs.readFileSync(packet+'COMMAND.pending.txt','utf8').replace('ROOT_APPROVED_GRANT_SHA256',hash(fs.readFileSync(packet+'GO.json'))).replace('INDEPENDENT_REVIEW_SHA256',hash(fs.readFileSync(packet+'REVIEW.json')));assert.equal(command.toString(),expected);
console.log(JSON.stringify({status:'PASS_BINDING_ONLY',at:new Date(now).toISOString(),grant:{bytes:fs.statSync(packet+'GO.json').size,sha256:hash(fs.readFileSync(packet+'GO.json')),mode:fs.statSync(packet+'GO.json').mode&4095},review:{bytes:fs.statSync(packet+'REVIEW.json').size,sha256:hash(fs.readFileSync(packet+'REVIEW.json')),mode:fs.statSync(packet+'REVIEW.json').mode&4095},command:{bytes:command.length,sha256:hash(command)},window:{issuedAt:new Date(grant.issuedAtEpochMs).toISOString(),latestStart:new Date(grant.latestStartEpochMs).toISOString(),expiresAt:new Date(grant.expiresEpochMs).toISOString()},archive:{bytes:archive.length,sha256:hash(archive),decodeCalls:0},sourceBinding:seal.sourceBinding,sourcePins:Object.keys(seal.files).length,helperPins:Object.keys(seal.helperPins).length,unusedPaths:pre.unusedPaths.length,emptyCapture:true,fullCensusRepeated:false,productCalls:0,activationLaunched:false},null,2));
