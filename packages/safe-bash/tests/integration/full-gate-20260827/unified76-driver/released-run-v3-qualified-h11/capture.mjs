import assert from 'node:assert/strict';
import {createReadStream,lstatSync,readdirSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGzip,gunzipSync} from 'node:zlib';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountFile} from '../launcher-v3/tap.mjs';

const directory=fileURLToPath(new URL('.',import.meta.url));
const repository=resolve(directory,'../../../../..');
const relative='tests/integration/full-gate-20260827/unified76-driver/released-run-v3-qualified-h11/';
const roots={inner:'/tmp/full-gate-unified76-f5-historical-h11-20260828-r3',outer:'/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-KRlFdr'};
const digest=value=>createHash('sha256').update(value).digest('hex');
const maximumRawBytes=128*1024*1024,maximumFileBytes=64*1024*1024,maximumCompressedBytes=32*1024*1024;
function census(root){
  const entries=[];
  function visit(current,prefix=''){
    for(const name of readdirSync(current).sort()){
      assert.ok(name!=='.'&&name!=='..'&&!name.includes('/')&&!name.includes('\0'));
      assert.notEqual(name.toLowerCase(),'agents.md','no instruction snapshot capture');
      const absolute=join(current,name),path=prefix+name,stat=lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink()&&(stat.isFile()||stat.isDirectory()));
      entries.push({path,type:stat.isDirectory()?'directory':'file',mode:stat.mode&0o777,bytes:stat.isFile()?stat.size:null});
      assert.ok(entries.length<=4096,'finite output census');
      if(stat.isDirectory())visit(absolute,path+'/');
    }
  }
  visit(root);return entries;
}
async function compressedFile(path){
  const hash=createHash('sha256'),gzip=createGzip({level:9}),chunks=[];
  let rawBytes=0,gzipBytes=0;
  const counter=new Transform({transform(chunk,_encoding,done){rawBytes+=chunk.length;assert.ok(rawBytes<=maximumFileBytes);hash.update(chunk);done(null,chunk);}});
  const completion=pipeline(createReadStream(path,{highWaterMark:65536}),counter,gzip);
  const consume=(async()=>{for await(const chunk of gzip){gzipBytes+=chunk.length;assert.ok(gzipBytes<=16*1024*1024,'per-file compressed bound');chunks.push(chunk);}})();
  await Promise.all([completion,consume]);
  const compressed=Buffer.concat(chunks),raw=gunzipSync(compressed,{maxOutputLength:maximumFileBytes});
  const sha256=hash.digest('hex');assert.equal(raw.length,rawBytes);assert.equal(digest(raw),sha256);
  return {rawBytes,sha256,gzipBytes,compressedSha256:digest(compressed),base64:compressed.toString('base64')};
}
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path,{highWaterMark:65536}))hash.update(chunk);return hash.digest('hex');}
export async function capture(){
  assert.equal(existsSync(join(directory,'EVIDENCE.json')),false,'append-only capture');
  const startedAt=new Date().toISOString();
  const packet=JSON.parse(readFileSync(join(directory,'../release-packet-v4-qualified-h11/PACKET.json')));
  assert.equal(digest(JSON.stringify(packet)),'d236cc7723dfaf860e3e70cda1d04bff2f46950c54c845d8ac0184e969296b00');
  for(const entry of [...packet.driver.files,...packet.independent.proofFiles])assert.equal(await hashFile(join(repository,entry.path)),entry.sha256,entry.path);
  const original=Object.fromEntries(Object.entries(roots).map(([role,root])=>[role,census(root)]));
  const rawTotal=Object.values(original).flat().filter(row=>row.type==='file').reduce((total,row)=>total+row.bytes,0);
  assert.ok(rawTotal<=maximumRawBytes,'finite raw capture');
  const report=JSON.parse(readFileSync(join(roots.inner,'REPORT.json'))),outer=JSON.parse(readFileSync(join(roots.outer,'REPORT.json')));
  assert.equal(report.candidate,packet.product.candidate);assert.equal(report.driverSha256,packet.driver.normalizedSha256);assert.equal(report.profileSha256,packet.profile.normalizedSha256);
  assert.equal(report.phases.length,6);assert.equal(outer.result.status,1);assert.equal(outer.result.closed,true);assert.equal(outer.status,'HOLD_OR_QUALIFIED_RED');
  const tap=await accountFile(join(roots.inner,'canonical.stdout'));
  assert.equal(tap.reconciled,true);assert.deepEqual(tap.counts,{pass:19425,fail:132,skipped:7,todo:0,cancelled:0});
  const paths=[...report.error.message.matchAll(/path: '([^']+)'/gu)].map(match=>match[1]);
  assert.equal(paths.length,286);
  const groups=new Map();
  for(const row of tap.nonpassing){
    const path=(row.location??'UNKNOWN').replace(/^.*\/source\//u,'').replace(/:\d+(?::\d+)?$/u,'');
    const key=row.status+' '+path;
    if(!groups.has(key))groups.set(key,{status:row.status,path,cases:[]});
    groups.get(key).cases.push(row);
  }
  const files=[],patches=[];let compressedTotal=0;
  for(const [role,root]of Object.entries(roots))for(const entry of original[role]){
    if(entry.type!=='file')continue;
    const captured=await compressedFile(join(root,entry.path));
    assert.equal(captured.rawBytes,entry.bytes);
    compressedTotal+=captured.gzipBytes;assert.ok(compressedTotal<=maximumCompressedBytes);
    const artifact=relative+'raw-v1/'+role+'/'+entry.path+'.gz.base64';
    const encoded=captured.base64+'\n';
    const {base64,...binding}=captured;
    files.push({role,path:entry.path,mode:entry.mode,artifact,...binding,encodedSha256:digest(encoded)});
    patches.push({path:artifact,text:encoded});
  }
  for(const [role,root]of Object.entries(roots))assert.deepEqual(census(root),original[role],'raw output census changed during capture');
  for(const file of files)assert.equal(await hashFile(join(roots[file.role],file.path)),file.sha256,'raw output bytes changed during capture');
  const phaseOutcomes=packet.phases.map(({name,expectedStatus})=>{const row=report.phases.find(phase=>phase.label===name);return {label:name,expectedStatus,execution:row?'EXECUTED':'NOT_EXECUTED',actualStatus:row?.status??null,clean:row?.clean??null,closed:row?.closed??null};});
  const summary={schema:1,candidate:report.candidate,driverSha256:report.driverSha256,profileSha256:report.profileSha256,expectedPackageSha256:packet.product.expectedPackageSha256,authorizationCommit:'021302a1',authorization:'ROOT-2026-08-28-UNIFIED76-QUALIFIED-H11-R3-ONE-ATTEMPT',authorizationConsumed:true,execSession:93642,launchCount:1,coordinatorExit:1,outerStatus:outer.status,startedAt:report.startedAt,finishedAt:report.finishedAt,phaseOutcomes,
    canonical:{counts:tap.counts,summary:tap.summary,reconciled:tap.reconciled,qualification:'Offline source-bound parsing of captured TAP after the run; original REPORT never reached canonical accounting after the integrity halt. No suite rerun or gate-verdict replacement.'},
    integrityHalt:{headline:report.error.message.split('\n')[0],addedEntries:paths.length,tableTextTemporaryRoots:new Set(paths.filter(path=>path.includes('/.native-')).map(path=>path.split('/').slice(0,4).join('/'))).size,otherAdded:paths.filter(path=>!path.includes('/.native-')),paths},
    benchmarkTypes:{status:1,qualification:'Checker did not start: build-audit.mjs cannot resolve benchmarks/node_modules/typescript. No workaround or fallback.'},
    driverProductionBuilds:report.driverProductionBuilds,bindingComplete:report.bindingComplete,guardsPassed:report.guardsPassed,cleanupComplete:report.cleanupComplete,
    private:{head:report.privateBefore.head,recordedUnchanged:report.privateUnchanged,recordedChangedFiles:report.privateFileChanges,copiedFiles:report.prerequisites.safejs.files.length,qualification:'Only the existing captured before/after checks; no new private read, status/index refresh or proof beyond their recorded scope.'},
    historicalEligibility:{profile:report.historicalEligibility.profile,admissionProbesRepeated:report.historicalEligibility.admissionProbesRepeated,obligations:report.historicalEligibility.obligations.map(({id,status,nativeParity,observation})=>({id,status,nativeParity,observation}))},
    closure:{outer: {status:outer.result.status,signal:outer.result.signal,closed:outer.result.closed,clean:outer.result.clean,observability:outer.result.observability,faultCount:outer.result.faultCount,signals:outer.result.signals,survivors:outer.result.survivors},completedPhaseCount:outer.fence.phaseReceipt.completed,fenceClean:outer.fence.clean,observerSurvivors:outer.fence.observerReceipt.survivors,innerVerdict:outer.innerVerdict,qualification:'Six phase and outer child receipts close cleanly, but aggregate fence/cleanup/integrity are NOT qualified; final sweep and eight dependent phases did not execute. Not universal kernel drain.'},
    sourceRootsRetained:{output:roots.inner,outer:roots.outer,temporary:report.temporary,cleanupMessage:report.cleanup},
    noProductRepairs:true,noPermissionWidening:true,noRetry:true,qualification:'Historical composition only. Raw132 failures and7 skips retained, not attributed/deducted as NA failures or all product bugs. No pack/public phase, full-release or currentHEAD acceptance.'};
  const evidence={schema:1,capturedAt:new Date().toISOString(),captureStartedAt:startedAt,metadataAndDataOnly:true,rawRoots:roots,files:files.length,directories:Object.values(original).flat().filter(row=>row.type==='directory').length,rawBytes:rawTotal,compressedBytes:compressedTotal,rawPrePostUnchanged:true,bounds:{maximumRawBytes,maximumFileBytes,maximumCompressedBytes,maximumEntriesPerRoot:4096},inventory:original,artifacts:files,qualification:'All regular output/outer files streamed and hash-checked before/after; gzip roundtrips verified. Source tree is retained in place, not recopied. No child or private/gate execution during capture.'};
  const documents={'EVIDENCE.json':evidence,'SUMMARY.json':summary,'TAP-NONPASSING.json':{summary:tap.summary,counts:tap.counts,reconciled:tap.reconciled,groups:[...groups.values()],qualification:summary.canonical.qualification}};
  for(const [name,value]of Object.entries(documents))patches.push({path:relative+name,text:JSON.stringify(value,null,2)+'\n'});
  console.log('*** Begin Patch');
  for(const patch of patches)console.log('*** Add File: '+patch.path+'\n'+patch.text.trimEnd().split('\n').map(line=>'+'+line).join('\n'));
  console.log('*** End Patch');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.deepEqual(process.argv.slice(2),['--emit-evidence-patch']);await capture();}
