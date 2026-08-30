import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const home=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve('tests/compatibility/bash-ere-transport-corrections-20260829');
const fd=fs.openSync(path.join(home,'PREPARATION.json'),'wx',0o600);
const insist=(value,code)=>{if(!value)throw Error(code);};
const hash=data=>createHash('sha256').update(data).digest('hex');
function raw(filename,cap=262144){const info=fs.lstatSync(filename);insist(info.isFile()&&!info.isSymbolicLink()&&info.size<=cap,'TEXT_ADMISSION');const data=fs.readFileSync(filename);insist(data.length===info.size,'READ_SIZE');return data;}
const bind=filename=>({path:filename,bytes:fs.lstatSync(filename).size,mode:fs.lstatSync(filename).mode&511,sha256:hash(raw(filename))});
function object(data,oid){insist(createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')===oid,'STORED_OBJECT');}
let result;
try{
 const packetBytes=raw(path.join(source,'REVIEW-BINDINGS-v2.json'));object(packetBytes,'60842ef8f612d028a88f8a17978e8a02546282e9');const packet=JSON.parse(packetBytes);
 const encoded=raw(path.join(source,'ACTUAL.json.gz.base64.data'));object(encoded,'cfeeb46cdf33719ebf4f1d8ccbd6a9728f5a44de');
 const compressed=Buffer.from(encoded.toString('utf8').trimEnd(),'base64');insist(compressed.length===packet.archive.compressedBytes&&hash(compressed)===packet.archive.compressedSha256,'COMPRESSED_BINDING');
 const data=gunzipSync(compressed,{maxOutputLength:packet.archive.uncompressedBytes});insist(data.length===packet.archive.uncompressedBytes&&hash(data)===packet.archive.uncompressedSha256,'INFLATED_BINDING');
 const archive=JSON.parse(data);insist(archive.files.length===69&&new Set(archive.files.map(row=>row.path)).size===69,'ARCHIVE_MEMBERSHIP');
 const selected=['errors.js','limits.js','transport/protocol.js','transport/accounting.js','transport/validation.js'];const assets=[];
 for(const name of selected){const expected=packet.assets.find(row=>row.path===name);const candidates=archive.files.filter(row=>row.path.startsWith('RUN-v3/')&&row.path.endsWith('/emitted/'+name));insist(candidates.length===1,'ASSET_LOCATOR:'+name+':'+JSON.stringify(archive.files.filter(row=>row.path.endsWith(name)).map(row=>row.path)));const row=candidates[0],bytes=Buffer.from(row.base64,'base64');insist(bytes.length===expected.bytes&&hash(bytes)===expected.sha256&&row.sha256===expected.sha256,'ASSET_HASH');const filename=path.join(home,'emitted',name);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});fs.writeFileSync(filename,bytes,{flag:'wx',mode:0o644});assets.push({...bind(filename),archivePath:row.path});}
 fs.writeFileSync(path.join(home,'emitted/package.json'),' {"type":"module"}\n',{flag:'wx',mode:0o644});
 const controls=raw(path.join(source,'pure-controls.mjs.data'));object(controls,'67436e2943de6218cf4342c1d11c460e2b898b86');fs.writeFileSync(path.join(home,'author.mjs'),controls,{flag:'wx',mode:0o644});
 fs.writeFileSync(path.join(home,'PURE-LOADS.json'),JSON.stringify(assets.map(({archivePath,...row})=>row),null,2)+'\n',{flag:'wx',mode:0o600});
 const inputs=['REVIEW-PACKET-v2.md','REVIEW-BINDINGS-v2.json','ROOT-POLICY-DECISION.md','ROOT-POLICY-MANIFEST.json','PROFILE-LEDGER.md','UNITS.md','PURE-CASES.json','REMAINING-VALIDATION-v2.json','pure-controls.mjs.data','ACTUAL.json.gz.base64.data'].map(name=>bind(path.join(source,name)));
 const oids={accounting:'f6c8ea489ff6adff5aad577753e1141f6cbc7305',owner:'547a529f9522d8b22788947e2114694497e3b241',protocol:'77c9bbddcec5da13e4440b63228f3f1101948d4b',root:'47293e5221cba40be652132cccbd8c148bb08faa',validation:'df1964e3b8e1d5c461b911faa483656c7a4bd26e','wire-engine':'c4dcb4dc8c16db3884080ae83c9e7c51eae63269','worker-entry':'f27ea90106d71eb51b3e9bbb41eb43d1ff2b0b16'};
 for(const[name,oid]of Object.entries(oids)){const filename=path.resolve('src/commands/regex-execution/ere/transport/'+name+'.ts');object(raw(filename),oid);inputs.push({...bind(filename),gitBlob:oid});}
 const node={path:'/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',bytes:112989184,mode:0o755,sha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011'};const info=fs.lstatSync(node.path);insist(info.isFile()&&info.size===node.bytes&&(info.mode&511)===node.mode,'NODE_METADATA');const digest=createHash('sha256');let size=0;for await(const chunk of fs.createReadStream(node.path,{highWaterMark:65536})){size+=chunk.length;insist(size<=node.bytes,'NODE_CAP');digest.update(chunk);}insist(size===node.bytes&&digest.digest('hex')===node.sha256,'NODE_HASH');
 const own=['PLAN.md','prepare.mjs','parent.mjs','dispatch.mjs','novel.mjs','author.mjs','PURE-LOADS.json','emitted/package.json'].map(name=>bind(path.join(home,name)));
 const seal={schema:'INDEPENDENT_PRIVATE_ERE_CORRECTIONS_PRESEAL',sourceCommit:packet.testedSource,engineCommit:packet.testedEngine,inputs,assets,own,node,authorCases:12,novelCases:12,Workers:0,limits:{minutes:20,knownOS:48,peak:3,capture:67108864,work:268435456,pureHelpers:3},started:new Date().toISOString()};const bytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');insist(bytes.length<=262144,'SEAL_CAP');fs.writeFileSync(path.join(home,'PRESEAL.json'),bytes,{flag:'wx',mode:0o600});
 result={status:'PRESEALED_NOT_RUN',sha256:hash(bytes),assets:assets.map(row=>({path:row.archivePath,sha256:row.sha256})),sourceRows:7,Workers:0};
}catch(error){result={status:'HOLD',message:error.message};process.exitCode=1;}
fs.writeSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);process.stdout.write(JSON.stringify(result)+'\n');
