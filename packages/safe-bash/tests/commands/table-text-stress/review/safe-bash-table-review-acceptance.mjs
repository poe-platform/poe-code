import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {root,work,sha,save,manifest,drift,snapshot} from './safe-bash-table-review-tools.mjs';
assert.ok(existsSync('/tmp/safe-bash-table-text-fixer.closed'), 'explicit production/tests closure required');
const closure=readFileSync('/tmp/safe-bash-table-text-fixer.closed','utf8');
const cwd=snapshot('closed');
mkdirSync(`${work}/native-temp`,{recursive:true});
save(`${work}/native-temp/sentinel`,'independent-table-text-review-owned\n');
const before=manifest(cwd), liveBefore=manifest(root);
const commands=[];
function run(name,binary,args,env={}) {
  const result=spawnSync(binary,args,{cwd,env:{...process.env,TMPDIR:`${work}/native-temp`,...env},encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024});
  const log=result.stdout+result.stderr;
  save(`${work}/${name}.log`,log);
  commands.push({name,binary,args,env,exitCode:result.status,signal:result.signal,error:result.error?.message??null,logSha256:sha(log),pass:Number(log.match(/# pass (\d+)/)?.[1]??0),fail:Number(log.match(/# fail (\d+)/)?.[1]??0),skipped:Number(log.match(/# skipped (\d+)/)?.[1]??0)});
}
const author=readdirSync(`${cwd}/tests/commands/table-text`).filter(name=>name.endsWith('.test.ts')).sort().map(name=>`tests/commands/table-text/${name}`);
run('closed-author311',process.execPath,['--unhandled-rejections=strict','--import','tsx','--test',...author,'tests/plugins/agent-commands.test.ts','tests/integration/adapter-tools-diagnostics/eight-cases.test.ts','tests/commands/structured-stress/split-increment/interop.test.ts','tests/commands/structured-stress/final-increment/fresh-interop.test.ts'],{GNU_TABLE_BIN:`${root}/tests/commands/metadata-stress/.oracle/coreutils-9.7/src`});
const independent=readdirSync(`${cwd}/tests/commands/table-text-stress`).filter(name=>name.endsWith('.test.ts')).sort().map(name=>`tests/commands/table-text-stress/${name}`);
run('closed-independent',process.execPath,['--unhandled-rejections=strict','--import','tsx','--test',...independent]);
run('closed-scoped-types',process.execPath,['node_modules/typescript/bin/tsc','--noEmit','-p','tests/commands/table-text-stress/tsconfig.json']);
run('closed-build',process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']);
if (commands.at(-1).exitCode===0) {
  save(`${cwd}/safe-bash-table-review-built.mjs`,readFileSync('/tmp/safe-bash-table-review-built.mjs','utf8'));
  run('closed-built-replay',process.execPath,['--unhandled-rejections=strict','safe-bash-table-review-built.mjs']);
}
const after=manifest(cwd), liveAfter=manifest(root);
const audit=JSON.parse(readFileSync(`${work}/audit-inputs.json`));
const record={closure,time:new Date().toISOString(),node:process.version,nodeBinarySha256:sha(readFileSync(process.execPath)),cwd,commands,snapshotDrift:drift(before,after),liveDrift:drift(liveBefore,liveAfter),auditToClosedDrift:drift(audit.frozen,before)};
save(`${work}/closed-acceptance.json`,record);
console.log(JSON.stringify(record,null,2));
