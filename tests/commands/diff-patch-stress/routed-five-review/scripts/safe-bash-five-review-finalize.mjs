import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root,work,owned,sha,save,manifest,drift,git} from './safe-bash-five-review-tools.mjs';
const cwd=join(work,'snapshot'),snapshot=JSON.parse(readFileSync(join(work,'snapshot.json'))),five=JSON.parse(readFileSync(join(work,'five-replay.json'))),table=JSON.parse(readFileSync(join(work,'table-verification.json'))),current=JSON.parse(readFileSync(join(work,'table-current-helper-verification.json')));
assert.equal(current.command.pass,311);assert.equal(current.command.fail,0);assert.equal(current.command.exitCode,0);
const before=manifest(cwd);assert.deepEqual(drift(snapshot.frozen,before),[]);
const nativeFinal={};
for(const [name,identity] of Object.entries(five.tools)) {const measured=sha(readFileSync(identity.executable));assert.equal(measured,identity.sha256);nativeFinal[name]={path:identity.executable,sha256:measured};}
const human=JSON.parse(readFileSync(join(work,'independent-human-native.json')));
for(const identity of human.binaryRecords) {const measured=sha(readFileSync(identity.path));assert.equal(measured,identity.hash);nativeFinal[identity.label]={path:identity.path,sha256:measured};}
const tableProfile=JSON.parse(readFileSync(join(cwd,'tests/commands/table-text-stress/first-discrepancy.json')));
for(const name of ['paste','comm','join']) {const path=join(root,'tests/commands/metadata-stress/.oracle/coreutils-9.7/src',name),measured=sha(readFileSync(path));assert.equal(measured,tableProfile.identities[name].sha256);nativeFinal['table-'+name]={path,sha256:measured};}
const priorMutationPath='tests/commands/table-text-stress/review/mutation-results-verified.json';
const priorMutation=JSON.parse(readFileSync(join(cwd,priorMutationPath)));
assert.equal(priorMutation.results.length,4);assert.ok(priorMutation.results.every(control=>control.killed&&control.semanticAssertion));
assert.equal(priorMutation.pristineSourceSha256,before['src/commands/table-text/internal.ts']);assert.equal(priorMutation.afterSourceSha256,priorMutation.pristineSourceSha256);assert.deepEqual(priorMutation.inputDrift,[]);
const commands=[];
for(const [name,args] of [
  ['review-evidence-tests',['--unhandled-rejections=strict','--import','tsx','--test',owned+'/review.test.ts']],
  ['review-evidence-types',['node_modules/typescript/bin/tsc','--noEmit','-p',owned+'/tsconfig.json']],
]) {
  const result=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,TSX_DISABLE_CACHE:'1',TMPDIR:join(work,'runtime-temp')},encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.signal,null);
  save(join(work,name+'.stdout'),result.stdout);save(join(work,name+'.stderr'),result.stderr);
  commands.push({name,args,exitCode:result.status,signal:result.signal,stdoutBase64:Buffer.from(result.stdout).toString('base64'),stderrBase64:Buffer.from(result.stderr).toString('base64'),stdoutSha256:sha(result.stdout),stderrSha256:sha(result.stderr),pass:Number(result.stdout.match(/^# pass (\d+)/m)?.[1]??0)});
}
const after=manifest(cwd);assert.deepEqual(drift(before,after),[]);
assert.equal(sha(readFileSync(process.execPath)),snapshot.node.sha256);
const runtime=join(work,'runtime-temp');assert.equal(readFileSync(join(runtime,'sentinel'),'utf8'),'safe-bash-five-final-review-runtime\n');
const runtimeFiles=[];
function walk(path,relative='') { for(const entry of readdirSync(path,{withFileTypes:true})) {const child=join(path,entry.name),key=relative?relative+'/'+entry.name:entry.name;assert.equal(lstatSync(child).isSymbolicLink(),false);if(entry.isDirectory())walk(child,key);else{assert.ok(entry.isFile());const bytes=readFileSync(child);runtimeFiles.push({path:key,bytes:bytes.length,sha256:sha(bytes)});}} }
walk(runtime);
rmSync(runtime,{recursive:true});
assert.equal(existsSync(join(work,'native-five')),false);
const residual=[];
for(const base of [cwd,join(work,'mutant-patch'),join(work,'mutant-stat')]) {
  function scan(path) {for(const entry of readdirSync(path,{withFileTypes:true})) {if(!entry.isDirectory()||entry.name==='node_modules'||entry.name==='dist'||entry.name==='.oracle')continue;const child=join(path,entry.name);if(entry.name.startsWith('.native-')||entry.name.startsWith('virtual-diff-patch-author-'))residual.push(child);else scan(child);}}
  scan(base);
}
assert.deepEqual(residual,[]);
const currentLive=manifest(root);
const record={at:new Date().toISOString(),snapshotHead:snapshot.headAfter,currentHeadLabel:git('rev-parse','HEAD'),dirty:git('status','--short'),index:git('diff','--cached','--raw'),snapshotBeforeDigest:sha(JSON.stringify(before)),snapshotAfterDigest:sha(JSON.stringify(after)),snapshotDrift:drift(before,after),originalSnapshotDrift:drift(snapshot.frozen,after),currentLiveDrift:drift(snapshot.frozen,currentLive),nativeFinal,nodeFinalSha256:sha(readFileSync(process.execPath)),priorTableMutation:{path:priorMutationPath,sha256:sha(readFileSync(join(cwd,priorMutationPath))),controls:4,sourceSha256:priorMutation.pristineSourceSha256,newMutationExecutions:0},commands,cleanup:{fiveNativeRemoved:true,tableNativeDirectoriesVerifiedAndRemoved:table.cleaned.length,runtimeSentinelVerified:true,runtimeFiles,runtimeRemoved:runtime,remainingOwnedNativeDirectories:residual,ownedProcesses:'All spawned replay/test/build/native children exited normally; no owned background child remains, no SIGSTOP used.',unattributedNativeArtifacts:'Not modified or deleted'},productionEditsByReviewer:0,sourceFixCommits:2,archiveCommits:2,originalRecipeOrOracleChangesByReviewer:0,currentHelperReplay:{pass:311,fail:0,authorization:current.release.path},strictOriginalHelper:{pass:291,failedFileLoads:3,intendedTestsNotExecuted:20},limits:['One accidental legacy Apple-stat invocation is retained/disclosed and excluded from GNU source acceptance.','Historical five4/5 exact; native-only dry-run tmp mismatch retained.','Old human three-digit fixture conflict and2/19 native precision gaps remain.','Original SGID6 unresolved; no SGID rerun.','Table native70/71 profile unchanged;311 current-helper acceptance does not erase strict historical dependency blocker.','Current built71x2 is not historical author6; no broad/full/global/72-hour/superiority claim.']};
save(join(work,'final-verification.json'),record);save(join(root,owned,'final-verification.json'),record);
console.log(JSON.stringify({evidenceChecks:commands[0].pass,noEmit:commands[1].exitCode,sourceDrift:record.snapshotDrift,liveDrift:record.currentLiveDrift.length,cleanedTableNative:table.cleaned.length,ownedNativeResidual:residual}));
