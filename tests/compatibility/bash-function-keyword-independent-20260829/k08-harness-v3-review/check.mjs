import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const own=new URL('.',import.meta.url);
function raw(name){const filename=new URL(name,own),stat=fs.lstatSync(filename);assert(stat.isFile()&&stat.size<=262144);return fs.readFileSync(filename);}
const preseal=JSON.parse(raw('PRESEAL.json'));function guards(){for(const row of preseal.files){const bytes=raw(row.path);assert.equal(bytes.length,row.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256);}}
guards();await import('./snapshot/controls-v2.mjs');assert.equal(process.exitCode,0);
const {admitOwnerArchive,validateTar,archiveFailureRecord}=await import('./snapshot/owner-archive.mjs');
const spec=JSON.parse(raw('snapshot/SEAL.json')),observation={};
const admitted=await admitOwnerArchive(spec,observation),tar=admitted.tarBuffer;
assert.equal(observation.decodeCalls,1);assert.equal(observation.decoderInput.sha256,spec.archive.sha256);assert.equal(observation.ledger.current,0);
const rows=[];function reject(id,buffer,manifest,count,code){let caught;try{validateTar(buffer,manifest,count);}catch(reason){caught=reason;}assert.equal(caught?.code,code);const record=archiveFailureRecord(caught);rows.push({id,pass:true,record});return record;}
const firstSize=Number.parseInt(tar.subarray(124,136).toString().replaceAll('\0','').trim(),8),firstEnd=512+Math.ceil(firstSize/512)*512;
const wrong=reject('N01-count-versus-alignment',tar.subarray(0,tar.length-1),spec.shipping,1005,'MANIFEST_COUNT');assert.equal(wrong.actualMembers,1006);assert.equal(wrong.expectedMembers,1005);assert.equal(wrong.alignmentRemainder,511);
const duplicated=Buffer.concat([tar.subarray(0,tar.length-1024),tar.subarray(0,firstEnd),tar.subarray(tar.length-1024)]);
const duplicate=reject('N02-duplicate-after-complete-set',duplicated,spec.shipping,1006,'MEMBER_DUPLICATE');assert.equal(duplicate.actualMembers,1006);
assert(firstSize>512);const truncated=reject('N03-aligned-missing-payload',tar.subarray(0,1024),spec.shipping,1006,'TAR_TRUNCATED');assert.equal(truncated.alignmentRemainder,0);
guards();const binding=JSON.parse(raw('BINDINGS.json'));for(const filename of binding.absent){let error;try{fs.lstatSync(filename);}catch(reason){error=reason;}assert.equal(error?.code,'ENOENT');}assert.equal(fs.readdirSync(binding.capture).length,0);
const result={utc:new Date().toISOString(),authorGroups:8,authorExit:0,novel:rows,admission:admitted.admission,observation,postguards:preseal.files.length,unusedPaths:binding.absent.length,emptyCapture:true,archiveAdmissionCallsInThisHelper:2,productCalls:0,extractions:0,workers:0};
fs.writeFileSync(new URL('RESULT.json',own),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('INDEPENDENT '+JSON.stringify(result));
