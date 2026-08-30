import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {root,work,sha,save,manifest,drift,git} from './safe-bash-five-review-tools.mjs';

for(const name of ['patch-quiet','stat-human']) assert.ok(existsSync(`/tmp/safe-bash-${name}.closed`));
const cwd=join(work,'snapshot'), before=manifest(cwd),liveBefore=manifest(root);
const commands=[];
function run(name,args,directory=cwd) {
  const result=spawnSync(process.execPath,args,{cwd:directory,env:{...process.env,TSX_DISABLE_CACHE:'1',TMPDIR:join(work,'runtime-temp')},encoding:'utf8',timeout:120000,maxBuffer:64*1024*1024});
  const stdout=result.stdout??'',stderr=result.stderr??'';
  save(join(work,name+'.stdout'),stdout); save(join(work,name+'.stderr'),stderr);
  const log=stdout+'\n'+stderr;
  const record={name,args,cwd:directory,exitCode:result.status,signal:result.signal,error:result.error?.message??null,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),pass:Number(log.match(/^# pass (\d+)/m)?.[1]??0),fail:Number(log.match(/^# fail (\d+)/m)?.[1]??0),skipped:Number(log.match(/^# skipped (\d+)/m)?.[1]??0)};
  commands.push(record);console.log(JSON.stringify(record));return {record,log};
}
mkdirSync(join(work,'runtime-temp'),{recursive:true});save(join(work,'runtime-temp/sentinel'),'safe-bash-five-final-review-runtime\n');
const prefix=['--unhandled-rejections=strict','--import','tsx','--test'];
const patchNew='tests/commands/diff-patch/patch-quiet.test.ts';
const statNew=['tests/commands/metadata-stress/stat-human.test.ts','tests/commands/metadata-stress/stat-human-native.test.ts'];
run('patch-quiet-new',[...prefix,patchNew]);
run('stat-human-new',[...prefix,...statNew]);
const patchOriginal=['patch.test.ts','patch-formats.test.ts','patch-gnu-publication.test.ts','patch-hunk-diagnostics-followup.test.ts','patch-reject-orientation-followup.test.ts','safety.test.ts','options-regressions.test.ts'].map(name=>'tests/commands/diff-patch/'+name);
run('patch-original-relevant',[...prefix,...patchOriginal]);
const statOriginal=['epoch-regression.test.ts','stat-precision.test.ts','stat-flags.test.ts','stat-effects.test.ts'].map(name=>'tests/commands/metadata-stress/'+name);
run('stat-original-epoch-width',[...prefix,...statOriginal]);
run('stat-original-author-profile',[...prefix,'--test-name-pattern=^stat (prints|lstat/default|printf escapes|missing fields|limits,)','tests/commands/metadata/stat.test.ts']);
run('sgid-archive-bytes',[...prefix,'tests/commands/metadata-stress/sgid-feasibility-archive.test.ts']);
const typeFiles=[patchNew,...statNew,...patchOriginal,...statOriginal,'tests/commands/metadata/stat.test.ts'];
save(join(cwd,'review-types.json'),{extends:'./tsconfig.json',compilerOptions:{noEmit:true},include:typeFiles});
run('source-target-types',['node_modules/typescript/bin/tsc','--noEmit','-p','review-types.json']);
const mutants=[];
for(const family of ['patch','stat']) {
  const target=join(work,'mutant-'+family);assert.ok(!existsSync(target));mkdirSync(target);
  for(const name of ['src','package.json','tsconfig.json']) cpSync(join(cwd,name),join(target,name),{recursive:true});
  const testPaths=family==='patch'?['tests/commands/diff-patch','tests/commands/diff-patch-stress/gnu-target/oracle.ts']:['tests/commands/metadata-stress/stat-human.test.ts','tests/commands/metadata-stress/helpers.ts'];
  for(const path of testPaths) {mkdirSync(join(target,path,'..'),{recursive:true});cpSync(join(cwd,path),join(target,path),{recursive:true});}
  symlinkSync(join(root,'node_modules'),join(target,'node_modules'));
  const path=family==='patch'?'src/commands/diff-patch/patch.ts':'src/commands/metadata/stat.ts';
  const current=readFileSync(join(target,path),'utf8');
  const historical=execFileSync('git',['show','bd2cacb:'+path],{cwd:root,encoding:'utf8'});
  const pattern=family==='patch'?'^quiet matches pinned native bytes/effects: (apply|reverse|failed hunk and reject)$':'^stat human numeric timestamp (-?0\\.125|1700000000123\\.456)$';
  const file=family==='patch'?patchNew:statNew[0];
  const args=[...prefix,'--test-name-pattern='+pattern,file];
  const baseline=run('mutation-'+family+'-baseline',args,target);
  assert.equal(baseline.record.exitCode,0);assert.equal(baseline.record.pass,3);
  save(join(target,path),historical);
  const mutation=run('mutation-'+family+'-historical',args,target);
  assert.equal(mutation.record.exitCode,1);assert.equal(mutation.record.fail,3);
  assert.match(mutation.log,/ERR_ASSERTION/);assert.doesNotMatch(mutation.log,/ERR_MODULE_NOT_FOUND|TransformError|SyntaxError|Cannot find module/);
  save(join(target,path),current);
  const restored=run('mutation-'+family+'-restored',args,target);
  assert.equal(restored.record.exitCode,0);assert.equal(restored.record.pass,3);
  mutants.push({family,path,currentSha256:sha(current),historicalSha256:sha(historical),baseline:baseline.record,mutation:mutation.record,restored:restored.record,scope:'Three exact existing new-author cases; old source in owned isolated copy; assertion failures only, no compiler/load failures.'});
}
const after=manifest(cwd),liveAfter=manifest(root);
assert.deepEqual(drift(before,after),[]);
save(join(work,'target-verification.json'),{at:new Date().toISOString(),headLabel:git('rev-parse','HEAD'),sourceBefore:before,sourceAfter:after,snapshotDrift:drift(before,after),liveDrift:drift(liveBefore,liveAfter),commands,mutants,originalAuthorStatSha256:sha(readFileSync(join(cwd,'tests/commands/metadata/stat.test.ts')))});
