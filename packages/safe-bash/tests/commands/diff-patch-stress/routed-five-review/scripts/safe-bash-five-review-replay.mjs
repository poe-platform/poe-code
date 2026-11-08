import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,symlinkSync,readdirSync,lstatSync,readlinkSync,rmSync} from 'node:fs';
import {fork,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {root,work,sha,save,manifest,drift,git} from './safe-bash-five-review-tools.mjs';
import {compare} from './safe-bash-five-final-review/historical/common.mjs';
import {recipes} from './safe-bash-five-final-review/historical/recipes.mjs';
import {observeNative,executeNative} from './safe-bash-five-final-review/historical/native.mjs';

const cwd=join(work,'snapshot');
for(const name of ['patch-quiet','stat-human']) assert.ok(existsSync(`/tmp/safe-bash-${name}.closed`));
const snapshot=JSON.parse(readFileSync(join(work,'snapshot.json')));
const frozenInputs=JSON.parse(readFileSync('/tmp/safe-bash-routed-five-inputs.json'));
const goldPath='benchmarks/reports/expanded-20260827/native-corrected/native.json';
const reportPath='benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json';
const functionalPath='benchmarks/reports/expanded-20260827/corrected-bd2cacb/functional.json';
const gold=JSON.parse(readFileSync(join(root,goldPath)));
const report=JSON.parse(readFileSync(join(root,reportPath)));
const functional=JSON.parse(readFileSync(join(root,functionalPath)));
assert.equal(sha(readFileSync(join(root,goldPath))),report.nativeGolden.sha256);
const evidencePaths=[goldPath,reportPath,functionalPath,'benchmarks/reports/expanded-20260827/ANALYSIS.md','benchmarks/package.json','benchmarks/package-lock.json'];
for(const path of [goldPath,reportPath,functionalPath]) {
  const original=execFileSync('git',['show','8e09db9:'+path],{cwd:root,maxBuffer:64*1024*1024});
  assert.equal(sha(readFileSync(join(root,path))),sha(original),`Historical8e09db9 evidence changed: ${path}`);
}
const evidenceBefore=Object.fromEntries(evidencePaths.map(path=>[path,sha(readFileSync(join(root,path)))]));
const before=manifest(cwd),liveBefore=manifest(root);
assert.deepEqual(drift(snapshot.frozen,before),[]);
const historical=join(work,'historical');
const harnessBefore={},harnessDiffs={};
for(const [name,digest] of Object.entries(report.harnessHashes)) {
  const original=readFileSync(join(historical,name));
  assert.equal(sha(original),digest);
  harnessBefore[name]=digest;
  const current=readFileSync(join(root,'benchmarks/expanded',name));
  if(sha(current)!==digest) harnessDiffs[name]={historicalSha256:digest,currentSha256:sha(current),historical:original.toString(),current:current.toString()};
}
const archiveRoot=join(root,'tests/commands/diff-patch-stress/routed-five-checkpoint');
const archive=JSON.parse(readFileSync(join(archiveRoot,'manifest.json')));
const archiveChecks=archive.artifacts.map(entry=> {
  const bytes=readFileSync(join(archiveRoot,entry.archive));
  assert.equal(bytes.length,entry.bytes); assert.equal(sha(bytes),entry.sha256);
  assert.deepEqual(bytes,readFileSync(entry.source));
  return {...entry,verified:true};
});
const historicalFailures=functional.filter(row=>!row['virtual-bash'].comparison.pass);
assert.equal(historicalFailures.length,18);
const retainedFailures=JSON.parse(readFileSync(join(archiveRoot,'frozen-eighteen-failures.json')));
assert.deepEqual(retainedFailures.rows,historicalFailures);
for(const entry of retainedFailures.sources) assert.equal(sha(readFileSync(join(root,entry.path))),entry.sha256);
const workspace=join(work,'native-five');
assert.ok(!existsSync(workspace)); mkdirSync(join(workspace,'bin'),{recursive:true});
save(join(workspace,'sentinel'),'safe-bash-five-final-review-native-only\n');
const tools={};
for(const name of ['bash','patch','stat','sha256sum','diff']) {
  const expected=gold.toolIdentities[name];
  assert.equal(sha(readFileSync(expected.executable)),expected.sha256,name);
  symlinkSync(expected.executable,join(workspace,'bin',name));
  const version=await executeNative(expected.executable,['--version'],{cwd:workspace,env:{PATH:join(workspace,'bin'),LC_ALL:'C',TZ:'UTC'},argv0:name});
  assert.equal(version.stdout.toString().slice(0,512),expected.versionStdout);
  assert.equal(version.exitCode,expected.versionExit); assert.equal(version.signal,null); assert.equal(version.reason,undefined);
  tools[name]={...expected,verified:true};
}
assert.match(tools.patch.versionStdout,/GNU patch 2\.8/);
assert.match(tools.stat.versionStdout,/GNU coreutils\) 9\.7/);
const child=fork(join(historical,'engine.mjs'),[],{cwd,execArgv:['--expose-gc','--unhandled-rejections=strict','--import','tsx','--max-old-space-size=256'],env:{...process.env,TSX_DISABLE_CACHE:'1',EXPANDED_ENGINE:'virtual-bash',EXPANDED_SOURCE_ROOT:cwd},stdio:['ignore','pipe','pipe','ipc']});
let logs=''; child.stdout.on('data',bytes=>{logs+=bytes;});child.stderr.on('data',bytes=>{logs+=bytes;});
const results=[]; let processExit;
try {
  const [ready]=await once(child,'message'); assert.equal(ready.ready,true,ready.error);
  for(const [index,row] of frozenInputs.selected.entries()) {
    assert.deepEqual(recipes().find(recipe=>recipe.id===row.specimen.id),row.specimen);
    assert.deepEqual(gold.recipes.find(recipe=>recipe.id===row.specimen.id),row.specimen);
    assert.equal(sha(JSON.stringify(row.specimen)),row.expected.recipeHash);
    assert.deepEqual(gold.observations.find(observation=>observation.id===row.specimen.id),row.expected);
    const pending=once(child,'message'); child.send({id:index+1,specimen:row.specimen,instrument:true,warmup:0});
    const [current]=await pending;
    assert.ok(current.observation,current.error);
    const native=await observeNative({workspace,bin:join(workspace,'bin'),bash:tools.bash.executable},row.specimen);
    const nativeMatchesFrozen=compare(row.expected,native);
    assert.equal(nativeMatchesFrozen.pass,true,row.specimen.id);
    const comparison=compare(row.expected,current.observation);
    const streamsAndStatus=['stdout','stderr','exitCode'].every(field=>row.expected[field]===current.observation[field]);
    const namespaceDifferences=[...new Set([...Object.keys(native.entries),...Object.keys(current.observation.entries)])].filter(path=>JSON.stringify(native.entries[path])!==JSON.stringify(current.observation.entries[path])).map(path=>({path,native:native.entries[path]??null,current:current.observation.entries[path]??null}));
    results.push({id:row.specimen.id,recipe:row.specimen,recipeSha256:row.expected.recipeHash,frozenNative:row.expected,frozenProduct:row.frozen,native,current,comparison,nativeMatchesFrozen,streamsAndStatus,namespaceDifferences});
    console.log(JSON.stringify({id:row.specimen.id,comparison,streamsAndStatus,namespaceDifferences}));
  }
} finally {
  const exiting=once(child,'exit');child.disconnect();const [code,signal]=await exiting;
  processExit={code,signal};assert.equal(code,0);assert.equal(signal,null);
}
for(const [name,identity] of Object.entries(tools)) assert.equal(sha(readFileSync(identity.executable)),identity.sha256,name);
const after=manifest(cwd),liveAfter=manifest(root);
const evidenceAfter=Object.fromEntries(evidencePaths.map(path=>[path,sha(readFileSync(join(root,path)))]));
const harnessAfter=Object.fromEntries(Object.keys(harnessBefore).map(name=>[name,sha(readFileSync(join(historical,name)))]));
assert.deepEqual(drift(before,after),[]);assert.deepEqual(evidenceBefore,evidenceAfter);assert.deepEqual(harnessBefore,harnessAfter);
assert.equal(readFileSync(join(workspace,'sentinel'),'utf8'),'safe-bash-five-final-review-native-only\n');
assert.deepEqual(readdirSync(workspace).sort(),['bin','sentinel']);
assert.deepEqual(readdirSync(join(workspace,'bin')).sort(),Object.keys(tools).sort());
for(const [name,identity] of Object.entries(tools)) { assert.ok(lstatSync(join(workspace,'bin',name)).isSymbolicLink());assert.equal(readlinkSync(join(workspace,'bin',name)),identity.executable); }
rmSync(workspace,{recursive:true});
const record={at:new Date().toISOString(),snapshotHead:snapshot.headAfter,liveHead:git('rev-parse','HEAD'),sourceRoot:cwd,historicalHarnessRevision:report.harnessRevision,frozenProductRevision:report.revision,harnessBefore,harnessAfter,harnessDiffs,evidenceBefore,evidenceAfter,archiveChecks,historicalFailureCount:historicalFailures.length,tools,results,processExit,logs,sourceBefore:before,sourceAfter:after,snapshotDrift:drift(before,after),liveDrift:drift(liveBefore,liveAfter),nativeCleanup:{verified:true,removed:workspace},counts:{rows:results.length,exact:results.filter(row=>row.comparison.pass).length,streamsAndStatus:results.filter(row=>row.streamsAndStatus).length,nativeFrozenExact:results.filter(row=>row.nativeMatchesFrozen.pass).length}};
save(join(work,'five-replay.json'),record);
console.log(JSON.stringify(record.counts));
