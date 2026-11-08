import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SourceTextModule} from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const pre=JSON.parse(await fs.readFile(root+'CONTROL-PRESEAL-v2.json','utf8'));
for(const [name,pin]of Object.entries(pre.files)){const raw=await fs.readFile(root+name);assert.equal(raw.length,pin.bytes);assert.equal(hash(raw),pin.sha256);}
const {admitOwnerArchive,validateTar,archiveFailureRecord}=await import('./owner-archive.mjs');
const spec=JSON.parse(await fs.readFile(root+'ARCHIVE-AUTHORITY.json','utf8'));
const rows=[];const group=async(id,fn)=>{try{rows.push({id,status:'PASS',evidence:await fn()});}catch(reason){rows.push({id,status:'FAIL',reason:{name:reason?.name,message:reason?.message,code:reason?.code}});}};
let admitted;
await group('A01',async()=>{const observation={};admitted=await admitOwnerArchive(spec,observation);assert.equal(admitted.admission.result.members,1006);assert.equal(admitted.admission.decodedBytes,5803008);assert.equal(observation.decodeCalls,1);assert.equal(observation.ledger.current,0);assert.deepEqual(observation.decoderInput,{bytes:981948,sha256:spec.archive.sha256});assert.deepEqual(observation.events,['lstat-type-size','bounded-read','postread-identity','exact-hash','descriptor-closed','concurrent-buffers-reserved','decoded','parsed']);return {admission:admitted.admission,observation,oldPredicate:{expected1002:spec.shipping.length!==1002,alignment:admitted.tarBuffer.length%512}};});
const reject=(buffer,manifest,count,code)=>{let reason;try{validateTar(buffer,manifest,count);}catch(error){reason=error;}assert.equal(reason?.code,code);const record=archiveFailureRecord(reason);assert.equal(record.code,code);return record;};
if(admitted){const tar=admitted.tarBuffer,shipping=spec.shipping,count=spec.archive.shippingMembers;
const firstSize=Number.parseInt(tar.subarray(124,136).toString().replace(/\0/g,'').trim(),8),firstEnd=512+Math.ceil(firstSize/512)*512;
const fixChecksum=buffer=>{buffer.fill(32,148,156);let sum=0;for(const byte of buffer.subarray(0,512))sum+=byte;buffer.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');return buffer;};
const change=(offset,bytes)=>{const copy=Buffer.from(tar);Buffer.from(bytes).copy(copy,offset);return fixChecksum(copy);};
await group('A02',async()=>{const result=[];for(const [kind,archive,code]of [['type',{...spec.archive,path:root},'TYPE'],['size',{...spec.archive,bytes:spec.archive.bytes-1},'SIZE'],['hash',{...spec.archive,sha256:'0'.repeat(64)},'HASH']]){const observation={};let caught;try{await admitOwnerArchive({...spec,archive},observation);}catch(reason){caught=reason;}assert.equal(caught?.code,code);assert.equal(observation.decodeCalls,0);assert.equal(observation.ledger.current,0);result.push({kind,code,observation});}return result;});
await group('A03',()=>[reject(tar,shipping,1002,'MANIFEST_COUNT'),reject(tar,shipping.slice(1),count,'MANIFEST_COUNT'),reject(tar,[shipping[0],...shipping.slice(0,-1)],count,'MANIFEST_DUPLICATE'),reject(tar,[{...shipping[0],path:'../outside'},...shipping.slice(1)],count,'MANIFEST_SHAPE')]);
await group('A04',()=>[reject(tar.subarray(0,tar.length-1),shipping,count,'TAR_ALIGNMENT'),reject(tar.subarray(0,512),shipping,count,'TAR_TRUNCATED'),reject(tar.subarray(0,tar.length-512),shipping,count,'TAR_TERMINATOR')]);
await group('A05',()=>{const unexpected=change(0,Buffer.alloc(100));unexpected.write('package/UNLISTED',0);fixChecksum(unexpected);const duplicate=Buffer.concat([tar.subarray(0,firstEnd),tar]);return [reject(unexpected,shipping,count,'MEMBER_UNEXPECTED'),reject(duplicate,shipping,count,'MEMBER_DUPLICATE')];});
await group('A06',()=>reject(tar.subarray(firstEnd),shipping,count,'MEMBER_COUNT'));
await group('A07',()=>{const payload=Buffer.from(tar);payload[512]^=1;const mode=change(100,Buffer.from('0000000\0'));return [reject(payload,shipping,count,'MEMBER_HASH'),reject(mode,shipping,count,'MEMBER_METADATA')];});
await group('A08',async()=>{const result=[reject(change(257,Buffer.from('BADTAR')),shipping,count,'TAR_FORMAT'),reject(change(156,Buffer.from('2')),shipping,count,'MEMBER_TYPE'),reject(change(157,Buffer.from('link')),shipping,count,'MEMBER_LINK')];const path=change(0,Buffer.alloc(100));path.write('package/../outside',0);fixChecksum(path);result.push(reject(path,shipping,count,'MEMBER_PATH'));let offset=0,padded;while(offset<tar.length-1024){const size=Number.parseInt(tar.subarray(offset+124,offset+136).toString().replace(/\0/g,'').trim(),8),next=offset+512+Math.ceil(size/512)*512;if(size%512){padded=Buffer.from(tar);padded[offset+512+size]=1;break;}offset=next;}assert.ok(padded);result.push(reject(padded,shipping,count,'TAR_PADDING'));for(const name of pre.syntaxFiles)new SourceTextModule(await fs.readFile(root+name,'utf8'),{identifier:name});return {records:result,syntaxOnly:pre.syntaxFiles.length,noEvaluation:true};});}
console.log(JSON.stringify({schema:'k08-v3-archive-controls-v1',rows,groups:rows.length,passes:rows.filter(row=>row.status==='PASS').length,productEvaluations:0,extractions:0,scope:'DATA admission and synthetic archive mutations; no product calls'},null,2));process.exitCode=rows.length===8&&rows.every(row=>row.status==='PASS')?0:1;
