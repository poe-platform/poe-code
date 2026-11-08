import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

const scope = dirname(fileURLToPath(import.meta.url)), root = resolve(scope, '../../../..');
const read = name => JSON.parse(readFileSync(join(scope, name)));
const proof = read('authentication.json'), evidence = read('execution.json'), remaining = read('remaining-execution.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer:64*1024*1024 });
const trace = run => {
  const raw = gunzipSync(Buffer.from(run.trace.gzipBase64, 'base64'));
  assert.equal(hash(raw), run.trace.sha256); assert.equal(raw.length, run.trace.bytes);
  return raw.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
};

test('two complete driver blobs are authenticated to historical and migration Git objects', () => {
  assert.equal(proof.drivers.length,2);
  assert.equal(proof.pinProof.length,14);
  assert.equal(proof.pinProof.filter(pin=>pin.migrated).length,2);
  for(const driver of proof.drivers){
    assert.equal(hash(git(['cat-file','blob',driver.oldBlob])),driver.oldHash);
    assert.equal(hash(git(['cat-file','blob',driver.newBlob])),driver.newHash);
    assert.equal(hash(driver.oldSource),driver.oldHash); assert.equal(hash(driver.newSource),driver.newHash);
  }
  assert.equal(proof.originalHookFailureCount,89);
  assert.equal(proof.canonicalFixtureAndTupleCrosswalk,88);
});

test('all archived source, test, config and package inputs match the frozen commit before and after', () => {
  assert.equal(evidence.candidate,'e192662d2fda90104ab5a7e59c9b5c88bf5838c3');
  assert.equal(evidence.failure.name,'AssertionError');
  assert.equal(remaining.failure,null);
  assert.equal(remaining.continuation.initialSha256,hash(readFileSync(join(scope,'execution.json'))));
  for(const capture of [evidence,remaining]){
    assert.ok(capture.endpointStable);
    for(const [path,input]of Object.entries(capture.inputProof)){
      assert.equal(hash(git(['cat-file','blob',input.blob])),input.sha256,path);
      assert.equal(capture.manifests[capture.initial][join(capture.project,path)],input.sha256,path);
      assert.equal(capture.manifests[capture.endpoint][join(capture.project,path)],input.sha256,path);
    }
  }
  for(const [name,hashValue]of Object.entries(evidence.reviewerInputs))assert.equal(hash(readFileSync(join(scope,name))),hashValue);
});

test('both whole89 profiles preserve denominators, identity control and actual native launches', () => {
  for(const name of ['primary-5.3','historical-3.2']){
    const run=evidence.runs.find(item=>item.label===name);
    assert.equal(run.counts.tests,89);assert.equal(run.rows.length,89);
    assert.equal(run.counts.pass+run.counts.fail,89);assert.equal(run.hookFailures,0);
    assert.equal(run.counts.skipped,0);assert.equal(run.counts.cancelled,0);assert.equal(run.counts.todo,0);
    assert.equal(run.rows.filter(row=>row.name.includes(': original-differential: ')).length,72);
    assert.equal(run.rows.filter(row=>row.name.includes(': original-syntax: ')).length,5);
    assert.equal(run.rows.filter(row=>row.name.includes(': current-gaps: ')).length,11);
    assert.ok(run.rows.find(row=>row.name.includes('pinned identity and original native lifecycle')).passed);
    assert.equal(run.nativeSpawns,90);
    const events=trace(run), profile=evidence.nativeBefore.find(item=>item.name===name);
    const spawns=events.filter(event=>event.kind==='spawn'&&evidence.nativeBefore.some(item=>item.executable===event.command));
    assert.ok(spawns.every(event=>event.command===profile.executable));
    assert.equal(spawns[0].args.at(-1),'--version');
    for(const spawn of spawns.slice(2)){
      assert.deepEqual(spawn.args.slice(0,3),['--noprofile','--norc','-c']);
      assert.equal(spawn.args.at(-1),'shell');assert.equal(spawn.env.LC_ALL,'C');
      assert.equal(spawn.env.HOME,spawn.cwd);assert.equal(spawn.env.TMPDIR,spawn.cwd);
    }
  }
});

test('three candidate message-assertion defects remain red while full89 mutants reject before cases', () => {
  const controls=evidence.runs.find(run=>run.label==='six-binding-controls');
  assert.deepEqual(controls.counts,{tests:6,pass:3,fail:3,cancelled:0,skipped:0,todo:0});
  assert.equal(controls.rows.filter(row=>!row.passed&&row.name.startsWith('changed driver rejected')).length,2);
  assert.equal(controls.rows.find(row=>row.name==='unchanged fixture pin still rejects mutation').passed,false);
  assert.match(Buffer.from(controls.child.stdout,'base64').toString(),/Comparison \{/u);
  for(const label of ['mutated-driver-1','mutated-driver-2']){
    const run=remaining.runs.find(run=>run.label===label);
    assert.equal(run.counts.tests,89);assert.equal(run.counts.fail,89);assert.equal(run.hookFailures,89);
    assert.equal(run.child.status,1);assert.equal(run.nativeSpawns,0);assert.equal(run.virtualSpawns,0);
    assert.equal(run.publicIndexLoads,0);
  }
  for(const label of ['current-guard-not-historical','historical-guard-not-current']){
    const run=remaining.runs.find(run=>run.label===label);
    assert.equal(run.child.status,0);assert.equal(run.nativeSpawns,0);assert.equal(run.virtualSpawns,0);
  }
});

test('every actual source import comes from regular archived files with exact phase hashes', () => {
  for(const capture of [evidence,remaining]) for(const run of capture.runs){
    assert.ok(run.guard);assert.equal(run.invalid.length,0);
    assert.deepEqual(capture.manifests[run.before],capture.manifests[run.after]);
    for(const load of trace(run).filter(event=>event.kind==='load')){
      assert.ok(load.valid);assert.equal(load.before,load.after);assert.equal(load.before,load.expected);
      assert.ok(load.path.startsWith(capture.project+'/'));
      assert.equal(capture.manifests[run.before][load.path],load.before);
      if(load.path.startsWith(capture.project+'/src/'))assert.equal(capture.inputProof[load.path.slice(capture.project.length+1)].sha256,load.before);
    }
  }
});

test('both native tools and copied development dependencies retain independent endpoint identities', () => {
  for(const profile of evidence.nativeBefore){
    assert.equal(evidence.nativeAfter.find(item=>item.path===profile.executable).sha256,profile.sha256);
    assert.equal(hash(readFileSync(profile.executable)),profile.sha256);
  }
  for(const [name,tool]of Object.entries(evidence.tools))assert.deepEqual(evidence.toolsAfter[name],tool.before);
  assert.equal(evidence.copiedToolsRegular,true);
});

test('own archive and bounded child groups are gone, and cleanup binds the raw run', () => {
  for(const [receipt,raw]of [['cleanup.json','execution.json'],['remaining-cleanup.json','remaining-execution.json']]){
    const cleanup=read(receipt);
    assert.equal(cleanup.rawSha256,hash(readFileSync(join(scope,raw))));
    assert.ok(cleanup.removed&&cleanup.allRecordedGroupsAbsent);assert.equal(existsSync(cleanup.scratch),false);
  }
});
