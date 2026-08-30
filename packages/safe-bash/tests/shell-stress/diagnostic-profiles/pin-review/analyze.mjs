import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const scope=dirname(fileURLToPath(import.meta.url)),root=resolve(scope,'../../../..');
const evidence=JSON.parse(readFileSync(join(scope,'execution.json')));
const baselineBytes=execFileSync('/usr/bin/git',['show',evidence.candidate+':benchmarks/shell-stress/diagnostic-profiles/native-baseline.json'],{cwd:root,maxBuffer:64*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(baselineBytes),'0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3');
const baseline=JSON.parse(baselineBytes),profiles=[];
for(const run of evidence.runs.slice(0,2)){
  const raw=gunzipSync(Buffer.from(run.trace.gzipBase64,'base64'));assert.equal(hash(raw),run.trace.sha256);
  const events=raw.toString().trim().split('\n').map(line=>JSON.parse(line));
  const closes=new Map(events.filter(event=>event.kind==='close').map(event=>[event.pid,event]));
  const nativeProfile=evidence.nativeBefore.find(profile=>profile.name===run.label);
  const nativeSpawns=events.filter(event=>event.kind==='spawn'&&event.command===nativeProfile.executable);
  const virtualSpawns=events.filter(event=>event.kind==='spawn'&&event.command===evidence.node.path&&event.args.some(arg=>arg.endsWith('/virtual-child.ts')));
  assert.equal(nativeSpawns.length,90);assert.equal(virtualSpawns.length,88);
  const reference=baseline.captures.find(capture=>capture.profile===run.label&&capture.argv0==='shell'&&capture.repetition===1);
  const cases=reference.rows.map((row,index)=>{
    const nativeSpawn=nativeSpawns[index+2],nativeClose=closes.get(nativeSpawn.pid);
    assert.deepEqual(nativeSpawn.args,row.args);
    assert.equal(nativeClose.input,Buffer.from(row.fixture.stdin??'').toString('base64'));
    assert.deepEqual(nativeSpawn.env,{PATH:'/usr/bin:/bin',HOME:nativeSpawn.cwd,TMPDIR:nativeSpawn.cwd,LANG:'C',LC_ALL:'C',TZ:'UTC',...row.fixture.env});
    assert.equal(nativeClose.status,row.observation.exitCode);
    assert.equal(nativeClose.stdout,row.observation.stdoutBase64);assert.equal(nativeClose.stderr,row.observation.stderrBase64);
    assert.equal(nativeClose.signal,null);assert.equal(nativeClose.overflow,false);
    const virtualSpawn=virtualSpawns[index],virtualClose=closes.get(virtualSpawn.pid);
    const request=JSON.parse(Buffer.from(virtualClose.input,'base64').toString());
    assert.deepEqual(request.fixture,row.fixture);assert.equal(virtualClose.status,0);assert.equal(virtualClose.signal,null);assert.equal(virtualClose.overflow,false);
    const actual=JSON.parse(Buffer.from(virtualClose.stdout,'base64').toString());
    const fields=Object.fromEntries(Object.keys(row.observation).map(key=>[key,isDeepStrictEqual(row.observation[key],actual[key])]));
    return {cohort:row.cohort,fixture:row.fixture,native:{spawn:nativeSpawn,close:nativeClose,files:'Verified by unchanged runNative/deepEqual assertion before product execution; not separately emitted in spawn trace'},virtual:{spawn:virtualSpawn,close:virtualClose},expected:row.observation,actual,fields,exact:Object.values(fields).every(Boolean)};
  });
  assert.equal(cases.filter(row=>row.exact).length,run.counts.pass-1);
  assert.equal(cases.filter(row=>!row.exact).length,run.counts.fail);
  assert.equal(Buffer.from(run.child.stdout,'base64').toString().includes('Frozen native profile drift:'),false);
  profiles.push({name:run.label,tests:run.counts,identity:run.rows.find(row=>row.name.includes('pinned identity and original native lifecycle')),nativeCaseTuplesMatched:88,nativeVersionAndLifecycleLaunches:2,productCaseObservations:88,cases});
}
const report={analyzedAt:new Date().toISOString(),candidate:evidence.candidate,initialRawSha256:hash(readFileSync(join(scope,'execution.json'))),nativeCaptureSha256:hash(baselineBytes),profiles,note:'No additional execution. All88 current tuples per profile independently decoded from raw child trace. File modes were not asserted by the frozen Observation/Snapshot model; no invented mode coverage. Historical differences remain exact.'};
const path=join(scope,'observations.json');assert.equal(existsSync(path),false);
execFileSync('apply_patch',[],{cwd:root,input:`*** Begin Patch\n*** Add File: ${relative(root,path)}\n${JSON.stringify(report,null,2).split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`,maxBuffer:64*1024*1024});
console.log(JSON.stringify(profiles.map(profile=>({profile:profile.name,tests:profile.tests,nativeCaseTuplesMatched:profile.nativeCaseTuplesMatched,productCases:profile.productCaseObservations}))));
