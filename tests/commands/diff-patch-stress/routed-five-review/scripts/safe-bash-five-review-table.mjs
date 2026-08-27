import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync,rmSync,lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {root,work,sha,save,manifest,drift,git} from './safe-bash-five-review-tools.mjs';

const releasePath='/tmp/safe-bash-table-text-resume-after-five.ready';
assert.ok(existsSync('/tmp/safe-bash-five-source-checkpoint.ready'));
assert.ok(existsSync(releasePath),'Root must release table phase after reporting source checkpoint');
const release={path:releasePath,text:readFileSync(releasePath,'utf8'),sha256:sha(readFileSync(releasePath))};
const cwd=join(work,'snapshot'),inputs=JSON.parse(readFileSync(join(work,'table-inputs.json')));
const beforeRestoring=manifest(cwd),restoredInputs=[];
for(const row of inputs.records) {
  const path=join(cwd,row.path),prior=readFileSync(join(work,'table-frozen',row.path));
  assert.equal(sha(prior),row.frozenSha256);
  if(sha(readFileSync(path))!==row.frozenSha256) {
    assert.ok(row.path.startsWith('tests/'),'Table source must remain unchanged; no production substitution');
    restoredInputs.push({path:row.path,snapshotSha256:sha(readFileSync(path)),historicalSha256:row.frozenSha256});
    save(path,prior.toString());
  }
  assert.equal(sha(readFileSync(path)),row.frozenSha256);
}
const before=manifest(cwd),liveBefore=manifest(root),commands=[];
function run(name,args,env={}) {
  const result=spawnSync(process.execPath,args,{cwd,env:{...process.env,TSX_DISABLE_CACHE:'1',TMPDIR:join(work,'runtime-temp'),...env},encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});
  const stdout=result.stdout??'',stderr=result.stderr??'',log=stdout+'\n'+stderr;
  save(join(work,name+'.stdout'),stdout);save(join(work,name+'.stderr'),stderr);
  const record={name,args,env,exitCode:result.status,signal:result.signal,error:result.error?.message??null,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),pass:Number(log.match(/^# pass (\d+)/m)?.[1]??0),fail:Number(log.match(/^# fail (\d+)/m)?.[1]??0),skipped:Number(log.match(/^# skipped (\d+)/m)?.[1]??0)};
  commands.push(record);console.log(JSON.stringify(record));return record;
}
const prefix=['--unhandled-rejections=strict','--import','tsx','--test'];
run('table-existing104',[...prefix,...inputs.independent]);
run('table-existing311',[...prefix,...inputs.author],{GNU_TABLE_BIN:join(root,'tests/commands/metadata-stress/.oracle/coreutils-9.7/src')});
run('table-scoped-types',['node_modules/typescript/bin/tsc','--noEmit','-p','tests/commands/table-text-stress/tsconfig.json']);
const build=run('table-isolated-build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']);
if(build.exitCode===0) {
  const original=readFileSync(join(work,'table-frozen/built-replay.mjs'));
  assert.equal(sha(original),inputs.builtReplaySha256);
  save(join(cwd,'table-current-built-replay.mjs'),original.toString());
  run('table-current-public-built71x2',['--unhandled-rejections=strict','table-current-built-replay.mjs']);
}
const corpus=JSON.parse(readFileSync(join(cwd,'tests/commands/table-text-stress/frozen-corpus.json')));
const cleaned=[];
const base=join(cwd,'tests/commands/table-text-stress');
for(const entry of readdirSync(base,{withFileTypes:true})) {
  if(!entry.name.startsWith('.native-')) continue;
  assert.ok(entry.isDirectory());const directory=join(base,entry.name);
  assert.equal(readFileSync(join(directory,'sentinel'),'utf8'),'independent-table-text-owned');
  const fixture=corpus.find(({fixture})=>{
    if(JSON.stringify(readdirSync(directory).sort())!==JSON.stringify(['sentinel',...Object.keys(fixture.files)].sort())) return false;
    return Object.entries(fixture.files).every(([name,hex])=>lstatSync(join(directory,name)).isFile()&&readFileSync(join(directory,name)).toString('hex')===hex);
  });
  assert.ok(fixture,'Refuse cleanup of unknown native namespace');
  cleaned.push({directory,fixture:fixture.fixture.name});rmSync(directory,{recursive:true});
}
const after=manifest(cwd),liveAfter=manifest(root);
assert.deepEqual(drift(before,after),[]);
save(join(work,'table-verification.json'),{at:new Date().toISOString(),headLabel:git('rev-parse','HEAD'),release,inputs,restoredInputs,beforeRestoring,sourceBefore:before,sourceAfter:after,snapshotDrift:drift(before,after),liveDrift:drift(liveBefore,liveAfter),commands,cleaned,cohorts:{independent:104,unchangedAuthor:311,frozenNativeInputs:71,knownCommGap:1,priorMutationControls:4,currentBuiltReplay:'71 original fixtures in each of pipeline/redirection modes; not historical author six checks'}});
