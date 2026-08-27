import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const owned=resolve('tests/stress/regex-execution/production-continuation-review');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(resolve(owned,path)));
const baseline=await json('evidence/baseline-freeze.json');
const candidate=await json('evidence/candidate-freeze.json');
const mismatches=[];
for(const freeze of [baseline,candidate]) {
  for(const entry of freeze.identities) if(hash(await readFile(resolve(owned,'snapshots',freeze.mode,entry.path)))!==entry.sha256) mismatches.push({kind:'snapshot',mode:freeze.mode,path:entry.path});
  const build=await json(`evidence/${freeze.mode}/build.json`);
  for(const entry of build.emitted) if(hash(await readFile(resolve(owned,'snapshots',freeze.mode,entry.path)))!==entry.sha256) mismatches.push({kind:'emitted',mode:freeze.mode,path:entry.path});
}
for(const entry of baseline.historical) if(hash(await readFile(entry.path))!==entry.sha256) mismatches.push({kind:'historical',path:entry.path});
const sourceDrift=[];
for(const entry of candidate.identities) if(hash(await readFile(entry.path))!==entry.sha256) sourceDrift.push(entry.path);
const differences=candidate.identities.filter(entry=>baseline.identities.find(previous=>previous.path===entry.path)?.sha256!==entry.sha256).map(entry=>({path:entry.path,baselineSha256:baseline.identities.find(previous=>previous.path===entry.path)?.sha256??null,candidateSha256:entry.sha256}));
const current=await readFile(resolve(owned,'child.mjs'),'utf8');
const intermediate=current.replace("import { walkerCases } from './walker-cases.mjs';\n",'').replace(current.slice(current.indexOf('async function walkerChecks()'),current.indexOf('async function benchmark()')),'').replace("    else if (job==='walker') await walkerChecks();\n",'');
const harnesses=[
  {name:'final-static-child',bytes:current},
  {name:'initial-preserved-child',bytes:await readFile(resolve(owned,'evidence/initial-child.mjs'))},
  {name:'corrected-preserved-child',bytes:await readFile(resolve(owned,'evidence/corrected-child.mjs'))},
  {name:'committed-f613f17-child',bytes:execFileSync('git',['show','f613f17:tests/stress/regex-execution/production-continuation-review/child.mjs'])},
  {name:'pre-walker-child-derived-by-removing-only-walker-import-function-dispatch',bytes:intermediate},
].map(({name,bytes})=>({name,sha256:hash(bytes)}));
const children=[];
for(const group of ['baseline','candidate','packed']) {
  for(const file of await readdir(resolve(owned,'evidence',group))) {
    if(!file.endsWith('-claim.json')) continue;
    const record=await json(`evidence/${group}/${file.replace('-claim','')}`);
    const harness=harnesses.find(item=>item.sha256===record.claim.childSha256);
    if(!harness) mismatches.push({kind:'unreconstructible-harness',group,file});
    const closed=record.code===0 && record.signal===null && !record.killed && ['disconnect','stdout-close','stderr-close','exit'].every(kind=>record.events.some(event=>event.kind===kind)) && record.result?.summary.active===0;
    const eventualWorkers=record.result?.final??[];
    const exactWorkerCleanup=eventualWorkers.every(worker=>worker.exited && worker.terminationCalls<=1 && Object.values(worker.listeners).every(count=>count===0));
    if(!closed || !exactWorkerCleanup) mismatches.push({kind:'child-cleanup',group,file,closed,exactWorkerCleanup});
    children.push({group,file,job:record.claim.job,pid:record.pid,pass:record.result?.pass,summary:record.result?.summary,closed,exactWorkerCleanup,harness:harness?.name,failures:record.result?.observations.filter(item=>!item.pass).map(item=>item.name),notApplicable:record.result?.observations.filter(item=>item.details?.notApplicable).map(item=>item.name)});
  }
}
const packageEvidence=await json('evidence/packed/package.json');
for(const asset of packageEvidence.assets) if(hash(await readFile(resolve(owned,'.temporary/moved/node_modules/virtual-bash',asset.path)))!==asset.sourceSha256) mismatches.push({kind:'packed-asset',path:asset.path});
const timings=(await json('evidence/candidate/benchmark.json')).result.observations.map(item=>item.details);
const median=values=>[...values].sort((left,right)=>left-right)[Math.floor(values.length/2)];
const output={time:new Date().toISOString(),baselineHead:baseline.head,candidateHead:candidate.head,baselineDirty:baseline.identities.filter(item=>item.dirty),candidateDirty:candidate.identities.filter(item=>item.dirty),historicalVerified:baseline.historical.length,sourceDrift,differences,harnesses,children,packagePass:packageEvidence.pass,timing:{workload:'32 files plus .ignore; expected13 selected lines; 3 alternating-order full-command pairs, startup and disposal included, VFS fixture population/import excluded',baselineMs:timings.map(item=>item.baseline.milliseconds),candidateMs:timings.map(item=>item.candidate.milliseconds),baselineMedianMs:median(timings.map(item=>item.baseline.milliseconds)),candidateMedianMs:median(timings.map(item=>item.candidate.milliseconds))},mismatches,riskConsumed:0,additionalSix:'UNUSED',defaultAcceptance:false};
await writeFile(resolve(owned,'evidence/audit.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mismatches,sourceDrift,differences:differences.map(item=>item.path),children:children.length,closed:children.filter(item=>item.closed).length,packagePass:output.packagePass,timing:output.timing}));
if(mismatches.length) process.exitCode=1;
