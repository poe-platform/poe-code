import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {candidate,copyDependencies,copySelection,node24,npm,save,sha,verifyAssembly} from './driver/common.mjs';
import {account} from '../../account.mjs';

const root=mkdtempSync(join(tmpdir(),'unified76-final-fixtures-'));
const source=join(root,'source');mkdirSync(source);
const remainingOnly=process.argv[2]==='--remaining-format';assert.ok(process.argv.length===2||remainingOnly&&process.argv.length===3);
const freeze=JSON.parse(readFileSync(new URL('./FREEZE.json',import.meta.url)));
const report={startedAt:new Date().toISOString(),root,candidate:candidate.candidate,assembly:verifyAssembly(),freezeSha256:sha(readFileSync(new URL('./FREEZE.json',import.meta.url))),commands:[],wholeGateLaunched:false,qualification:'One new full affected-file cohort; prior failures unchanged, no historical rescoring'};
const environment={PATH:`${dirname(node24)}:/usr/bin:/bin`,HOME:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',npm_config_cache:join(root,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
function run(label,args,cwd=source){
  const result=spawnSync(node24,args,{cwd,env:environment,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  writeFileSync(join(root,label+'.stdout'),result.stdout??'',{flag:'wx'});writeFileSync(join(root,label+'.stderr'),result.stderr??'',{flag:'wx'});
  const row={label,args,cwd,status:result.status,signal:result.signal,error:result.error?.message,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')};
  if(label.startsWith('fixture-'))row.accounting=account(result.stdout??'');
  report.commands.push(row);return row;
}
try{
  report.inputs=copySelection(source,['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json','tests/commands/split','tests/commands/stream-format','tests/commands/stream-format-author-stress','tests/integration/stream-inspection-public-author','tests/plugins/stream-five-public']);
  copyDependencies(join(source,'node_modules'));
  assert.equal(run('build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']).status,0);
  const pack=join(root,'pack');mkdirSync(pack);assert.equal(run('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]).status,0);
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.packageSha256=sha(readFileSync(tarball));assert.equal(report.packageSha256,candidate.expectedPackageSha256);
  for(const file of freeze.files.filter(row=>row.path.endsWith('.test.ts')&&(!remainingOnly||row.path.includes('stream-format-author-stress'))))run('fixture-'+file.path.split('/').at(-2),['--import','tsx','--test','--test-reporter=tap','--test-concurrency=2',file.path]);
  const consumer=join(root,'consumer');mkdirSync(join(consumer,'node_modules/virtual-bash'),{recursive:true});
  execFileSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',join(consumer,'node_modules/virtual-bash')],{timeout:30000});
  writeFileSync(join(consumer,'package.json'),'{"type":"module","private":true}\n');writeFileSync(join(consumer,'consumer.mjs'),readFileSync(join(source,'tests/plugins/stream-five-public/consumer.mjs')));
  const moved=join(root,'moved package');renameSync(consumer,moved);
  if(!remainingOnly)run('fixture-stream-five',['--test','--test-reporter=tap','consumer.mjs'],moved);
  const rows=report.commands.filter(row=>row.label.startsWith('fixture-'));
  assert.equal(rows.length,remainingOnly?1:4);
  report.totals={pass:0,fail:0,skipped:0,todo:0,cancelled:0};
  for(const row of rows){assert.equal(row.error,undefined);assert.equal(row.signal,null);assert.ok(row.accounting.reconciled);for(const key of Object.keys(report.totals))report.totals[key]+=row.accounting.counts[key];}
  for(const row of rows)assert.equal(row.status,0,row.label);
  assert.deepEqual(report.totals,{pass:remainingOnly?19:68,fail:0,skipped:0,todo:0,cancelled:0});report.remainingOnly=remainingOnly;
  for(const entry of report.inputs)assert.equal(sha(readFileSync(join(source,entry.path))),entry.sha256,entry.path);
  assert.equal(sha(readFileSync(tarball)),report.packageSha256);report.inputImmutability=true;report.status='SCOPED_PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,status:report.status,candidate:report.candidate,packageSha256:report.packageSha256,totals:report.totals,error:report.error,wholeGateLaunched:false}));}
