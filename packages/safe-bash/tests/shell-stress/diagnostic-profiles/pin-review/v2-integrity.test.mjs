import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

const scope=dirname(fileURLToPath(import.meta.url)),root=resolve(scope,'../../../..');
const evidence=JSON.parse(readFileSync(join(scope,'v2-execution.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('/usr/bin/git',args,{cwd:root,maxBuffer:64*1024*1024});

test('all fifteen prior review files remain immutable, including original three control failures',()=>{
  assert.equal(Object.keys(evidence.historyBefore).length,15);assert.deepEqual(evidence.historyBefore,evidence.historyAfter);
  for(const[path,expected]of Object.entries(evidence.historyBefore))assert.equal(hash(readFileSync(join(root,path))),expected,path);
  const previous=JSON.parse(readFileSync(join(scope,'execution.json')));
  assert.deepEqual(previous.runs.find(run=>run.label==='six-binding-controls').counts,{tests:6,pass:3,fail:3,cancelled:0,skipped:0,todo:0});
});

test('237 authenticated inputs differ only in the corrected control module, outside prior case load closure',()=>{
  assert.equal(evidence.sourceConfigDiff,'');assert.equal(evidence.exactControlTransform,true);assert.equal(evidence.exactRunnerTransform,true);
  assert.equal(Object.keys(evidence.inputProof).length,237);
  assert.equal(Object.values(evidence.inputProof).filter(proof=>proof.unchanged).length,236);
  assert.deepEqual(evidence.changedInputPaths,['tests/shell-stress/diagnostic-profiles/pin-migration/binding.test.ts']);
  for(const[path,proof]of Object.entries(evidence.inputProof)){
    assert.equal(hash(git(['cat-file','blob',proof.blob])),proof.sha256,path);
    assert.equal(evidence.initial[join(evidence.project,path)],proof.sha256,path);
    assert.equal(evidence.endpoint[join(evidence.project,path)],proof.sha256,path);
  }
  assert.ok(evidence.carriedRuns.every(run=>!run.changedControlLoaded));
  assert.equal(evidence.carriedRuns.find(run=>run.label==='primary-5.3').counts.pass,89);
  assert.equal(evidence.carriedRuns.find(run=>run.label==='historical-3.2').counts.pass,75);
  for(const run of evidence.carriedRuns.filter(run=>run.label.startsWith('mutated-driver'))){assert.equal(run.hookFailures,89);assert.equal(run.nativeSpawns,0);assert.equal(run.virtualSpawns,0);}
});

test('fresh six corrected controls pass; distinct wrong-code laboratory mutant is rejected',()=>{
  assert.equal(evidence.runs.length,2);
  assert.deepEqual(evidence.runs[0].counts,{tests:6,pass:6,fail:0,cancelled:0,skipped:0,todo:0});assert.equal(evidence.runs[0].child.status,0);
  assert.deepEqual(evidence.runs[1].counts,{tests:6,pass:3,fail:3,cancelled:0,skipped:0,todo:0});assert.equal(evidence.runs[1].child.status,1);
  const output=Buffer.from(evidence.runs[1].child.stdout,'base64').toString();assert.match(output,/PIN_REVIEW_WRONG_CODE/u);assert.match(output,/ERR_ASSERTION/u);
  assert.equal(evidence.mutation.beforeSha256,evidence.inputProof[evidence.mutation.path].sha256);
  assert.equal(evidence.freshNativeExecutions,0);assert.equal(evidence.freshProductExecutions,0);
});

test('actual imports, full archive, development tools, native binaries and Node remain authenticated',()=>{
  assert.equal(evidence.failure,null);assert.ok(evidence.endpointStable);assert.deepEqual(evidence.toolsBefore,evidence.toolsAfter);assert.deepEqual(evidence.nativeBefore,evidence.nativeAfter);
  for(const profile of evidence.nativeAfter)assert.equal(hash(readFileSync(profile.executable)),profile.sha256);
  assert.equal(hash(readFileSync(evidence.node.path)),evidence.node.sha256);
  assert.equal(hash(readFileSync(join(scope,'v2-review.mjs'))),evidence.driverSha256);
  for(const run of evidence.runs){
    assert.ok(run.guard);assert.deepEqual(run.before,run.after);assert.equal(run.caseLaunches.length,0);
    const raw=gunzipSync(Buffer.from(run.trace.gzipBase64,'base64'));assert.equal(hash(raw),run.trace.sha256);
    for(const event of raw.toString().trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.kind==='load')){
      assert.ok(event.valid);assert.equal(event.before,event.after);assert.equal(event.before,event.expected);assert.ok(event.path.startsWith(evidence.project+'/'));
    }
  }
});

test('regular scratch and owned runner groups are closed with a bound cleanup receipt',()=>{
  const cleanup=JSON.parse(readFileSync(join(scope,'v2-cleanup.json')));
  assert.equal(cleanup.rawSha256,hash(readFileSync(join(scope,'v2-execution.json'))));
  assert.ok(cleanup.removed&&cleanup.ownedRunnerGroupsAbsent&&cleanup.noNativeOrProductCaseLaunches);assert.equal(existsSync(cleanup.scratch),false);
});
