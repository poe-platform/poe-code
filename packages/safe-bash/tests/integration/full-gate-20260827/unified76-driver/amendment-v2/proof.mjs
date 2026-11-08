import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidate,copyDependencies,copySelection,blob,node24,npm,save,sha,verifyAssembly} from './driver/common.mjs';
import {account} from '../../account.mjs';

const root=mkdtempSync(join(tmpdir(),'unified76-amendment-proof-'));
const source=join(root,'source');mkdirSync(source);
const fixture='tests/integration/stream-inspection-public-author/public.test.ts';
const report={startedAt:new Date().toISOString(),root,candidate:candidate.candidate,previousCandidate:candidate.previousCandidate,assembly:verifyAssembly(),proofSourceSha256:sha(readFileSync(new URL(import.meta.url))),scope:'Versioned single-assertion proof, not a rescore of earlier fixtures or whole gate',commands:[],fullGateLaunched:false};
const environment={PATH:`${dirname(node24)}:/usr/bin:/bin`,HOME:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',npm_config_cache:join(root,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
function run(label,args){
  const result=spawnSync(node24,args,{cwd:source,env:environment,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  writeFileSync(join(root,label+'.stdout'),result.stdout??'',{flag:'wx'});
  writeFileSync(join(root,label+'.stderr'),result.stderr??'',{flag:'wx'});
  const row={label,args,status:result.status,signal:result.signal,error:result.error?.message,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')};
  if(args.includes('--test'))row.accounting=account(result.stdout??'');
  report.commands.push(row);assert.equal(result.signal,null);assert.equal(result.error,undefined);return result;
}
try{
  report.inputs=copySelection(source,['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json',fixture]);
  copyDependencies(join(source,'node_modules'));
  assert.equal(run('build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']).status,0);
  const pack=join(root,'pack');mkdirSync(pack);
  assert.equal(run('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]).status,0);
  report.tarballSha256=sha(readFileSync(join(pack,'virtual-bash-0.0.0.tgz')));
  assert.equal(report.tarballSha256,candidate.expectedPackageSha256);
  const header=['--import','tsx','--test','--test-reporter=tap','--test-concurrency=2'];
  writeFileSync(join(source,fixture),blob(fixture,candidate.previousCandidate));
  const previous=run('previous-targeted',[...header,'--test-name-pattern=^root family exports preserve',fixture]);
  assert.equal(previous.status,1);assert.match(previous.stdout,/public\.test\.ts:31:/u);
  writeFileSync(join(source,fixture),blob(fixture));
  const amended=run('amended-targeted',[...header,'--test-name-pattern=^root family exports preserve',fixture]);
  assert.equal(amended.status,1);assert.match(amended.stdout,/public\.test\.ts:32:/u);
  const complete=run('amended-full-file',[...header,fixture]);
  assert.equal(complete.status,1);assert.match(complete.stdout,/public\.test\.ts:32:/u);
  assert.equal(report.commands.at(-1).accounting.reconciled,true);
  assert.equal(report.commands.at(-1).accounting.counts.pass,20);
  assert.equal(report.commands.at(-1).accounting.counts.fail,1);
  const inspection=run('built-authorized-count',['--input-type=module','-e',`import assert from 'node:assert/strict';import{createAgentCommands,agentCommands,CommandRegistry}from${JSON.stringify(pathToFileURL(join(source,'dist/index.js')).href)};const definitions=createAgentCommands({streamInspection:{limits:{maxInputBytes:1024}}}).map(command=>command.name);assert.equal(definitions.length,76);assert.equal(new Set(definitions).size,76);assert.deepEqual(definitions.slice(73),['html-to-markdown','du','expr']);const commands=new CommandRegistry([{name:'custom',execute:()=>({exitCode:23})}]);await agentCommands({replace:true}).setup({commands,use(){throw Error('unexpected middleware')},registerFileSystem(){throw Error('unexpected fs')}});assert.equal(commands.list().length,77);console.log(JSON.stringify({ordinary:definitions.length,unique:new Set(definitions).size,custom:commands.list().length,appended:definitions.slice(73)}));`]);
  assert.equal(inspection.status,0);
  for(const entry of report.inputs)assert.equal(sha(readFileSync(join(source,entry.path))),entry.sha256,entry.path);
  report.productInputsUnchanged=true;
  report.result='EXPECTED_REMAINING_FIXTURE_FAILURE_RETAINED';
  report.remaining={path:fixture,line:32,expected:73,actual:76,suffixLine34:'not reached; existing literal also omits html-to-markdown/du/expr',changesAuthorizedOnlyAtLine31:true};
}catch(error){report.result='HARNESS_OR_UNEXPECTED_FAILURE';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,candidate:candidate.candidate,result:report.result,tarballSha256:report.tarballSha256,commands:report.commands,error:report.error,fullGateLaunched:false}));}
