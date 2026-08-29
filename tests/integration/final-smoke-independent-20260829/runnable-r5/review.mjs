import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const own=path.dirname(new URL(import.meta.url).pathname);
const base='/Users/kjopek/Workspace/safe-bash/tests/integration/final-smoke-preparation-20260829/runnable-r5';
const bindings=[];
function read(file,max=1048576){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max);const bytes=fs.readFileSync(file);assert.equal(bytes.length,stat.size);const sha256=crypto.createHash('sha256').update(bytes).digest('hex');bindings.push({file,bytes:bytes.length,sha256});return bytes.toString('utf8');}
try {
 if(process.argv[2]==='verify'){
 const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const admit=row=>{const body=read(row.path,4194304);assert.equal(Buffer.byteLength(body),row.bytes);assert.equal(sha(body),row.sha256);return body;};
 const activation=JSON.parse(read(path.join(base,'ACTIVATION-BINDING.json')));
 assert.equal(activation.packet.sha256,'4da24e5b3f8376885988e95d20287036df81e63eead1c8712f0d3a953e31bfba');
 const packet=JSON.parse(admit(activation.packet));admit(activation.launcher);admit(activation.bootstrap);admit(activation.producerReviewReceipt);
 assert.equal(activation.producerReviewReceipt.sha256,'708f5ec08e39a86efa848699c3fb1c8fb840b6eb72df16e0885fae765877ea47');
 const cache=new Map(packet.files.map(row=>[row.path,admit(row)]));assert.equal(cache.size,16);assert.equal(packet.consumerFiles.length,10);
 for(const row of packet.consumerFiles){assert.equal(sha(cache.get(row.path)),row.sha256);}
 for(const [filename,body] of cache)for(const match of body.matchAll(/(?:from\s*|import\s*\(?)['"](\.[^'"]+)['"]/g))assert(cache.has(path.resolve(path.dirname(filename),match[1])),match[1]);
 const binding=JSON.parse(admit(packet.binding));assert.equal(binding.shippingCount,1070);assert.equal(binding.members.length,1070);assert.equal(binding.archive.sha256,'de8741c1be9c870650e92944020fa2785114b7046ef1774af2c27ea79238e17a');assert.equal(binding.fit.total,330506183);
 for(const key of ['tools','fixture','scalarRows'])admit(binding[key]);
 const policy=cache.get(path.join(base,'policy.mjs'));
 const {activationTimes,validateGrant,limits}=new Function('assert',policy.replace(/^import .*;\n/m,'').replaceAll('export ','')+'\nreturn {activationTimes,validateGrant,limits};')(assert);
 const finish=read(path.join(base,'finish.mjs'));
 const groups=['fixed1200activation','latest-refusal','invalid-clock-refusal','pending-review-refusal','wrong-packet-refusal','accessor-refusal','consumer-closure-complete','mode-and-layout-source-routing'];
 const body=finish.slice(finish.indexOf('  const valid='),finish.indexOf('  for(const row of cache.values())'));
 assert(body.includes('check(groups[7]'));const outcomes=[];const check=(id,body)=>{body();outcomes.push({id,pass:true});};
 fs.writeFileSync(path.join(own,'PRESEAL.json'),JSON.stringify({time:new Date().toISOString(),bindings,groups,novel:['typed-clocks','typed-grants','layout-selector-boundary'],product:0,helperSourceSha256:sha(fs.readFileSync(new URL(import.meta.url)))},null,2)+'\n',{flag:'wx'});
 new Function('assert','activationTimes','validateGrant','limits','groups','check','consumerFiles','read','path','own',body)(assert,activationTimes,validateGrant,limits,groups,check,packet.consumerFiles,file=>({body:cache.get(file)}),path,base);
 check('typed-clocks',()=>{for(const value of [Infinity,1.5,'1',null,Number.MAX_SAFE_INTEGER])assert.throws(()=>activationTimes(value));assert.throws(()=>activationTimes(100,99));});
 check('typed-grants',()=>{const valid={schema:'FINAL_SMOKE_FIXED_ACTIVATION_R4',action:'ROOT_FINAL_COHERENT_SMOKE24',packetSha256:activation.packet.sha256,authorization:'DATA_ONLY',producerReview:activation.producerReview,preexecReview:'a'.repeat(40)};validateGrant(valid,activation.packet.sha256);for(const altered of [{...valid,extra:1},{...valid,preexecReview:3},{...valid,authorization:false}])assert.throws(()=>validateGrant(altered,activation.packet.sha256));});
 check('layout-selector-boundary',()=>{const contract=[...cache].find(([name])=>name.endsWith('/contract.mjs'))[1];for(const id of ['C01','C02','C07','C12','C13','C14','R16','R17'])assert(contract.includes(id));const runtime=cache.get(path.join(base,'runtime.mjs'));assert(runtime.includes('for(const layout of layouts)'));assert(runtime.includes('result.registeredShellDisposalCompleted,true'));assert(runtime.includes('result.rows.map(row=>row.id),ids'));assert(runtime.includes('outcome.row.stdoutEnd')||runtime.includes('result.row.stdoutEnd'));assert(!cache.get(packet.loader).includes('fsync'));assert.equal(limits.layoutMs,120000);assert.equal(limits.loaders,3);});
 for(const row of [...bindings]){const bytes=read(row.file,4194304);assert.equal(sha(bytes),row.sha256);}
 const command=JSON.parse(read(path.join(base,'COMMANDS.json')));
 const result={verdict:'QUALIFIED_FINAL_EXECUTABLE_PREEXEC_ACCEPT',utc:new Date().toISOString(),outcomes,activation,command,packetSha256:activation.packet.sha256,producer:'fc4afd513d7dec3c288a68e9b5deda9ac3a46b34',files:16,consumerFiles:10,shipping:1070,limits,bindings,qualifications:['SOURCE/PURE only; no install/materialization/runtime/loaders executed','Direct authenticated ESM target, not CJS/bare-specifier resolution proof','Sampled/quiescent logical work only, not prewrite quota/RSS','Three layout budgets each120s including30s retirement; fixed activation1200s including180s publication','Historical HOLDs preserved; fresh ROOT grant and this review binding required','Tool/source identities inherited producer DATA plus authenticated current manifests; no fresh exhaustive tool runtime-load census']};
 const encoded=JSON.stringify(result,null,2)+'\n';fs.writeFileSync(path.join(own,'RESULT.json'),encoded,{flag:'wx'});console.log(JSON.stringify({verdict:result.verdict,controls:outcomes.length,receiptSha256:sha(encoded),utc:result.utc,command:command.command}));
 }else{
 const metadata=read('/private/tmp/final-smoke-r5-producer-review-binding.stdout');
 console.log('METADATA',metadata);
 for(const name of ['HANDOFF.md','COMMANDS.json','ACTIVATION-BINDING.json'])console.log('\nFILE',name,read(path.join(base,name)));
 console.log('FILES',fs.readdirSync(base));
 fs.writeFileSync(path.join(own,'INSPECT-BINDINGS.json'),JSON.stringify(bindings,null,2)+'\n',{flag:'wx'});
 }
}catch(reason){console.error(reason);process.exitCode=1;}
