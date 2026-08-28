import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {candidate,copyDependencies,copySelection,blob,node24,npm,save,sha,verifyAssembly} from './common.mjs';
import {account} from '../account.mjs';

const root=mkdtempSync(join(tmpdir(),'unified76-fixture-proof-')),source=join(root,'source');mkdirSync(source);
const report={startedAt:new Date().toISOString(),root,assembly:verifyAssembly(),scope:'four exact fixture migrations and unchanged product package; no whole gate',commands:[]};
const environment={PATH:`${dirname(node24)}:/usr/bin:/bin`,HOME:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',npm_config_cache:join(root,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'};
function run(label,args,cwd=source){const result=spawnSync(node24,args,{cwd,env:environment,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});writeFileSync(join(root,label+'.stdout'),result.stdout??'');writeFileSync(join(root,label+'.stderr'),result.stderr??'');const row={label,args,cwd,status:result.status,signal:result.signal,error:result.error?.message};if(args.includes('--test'))row.accounting=account(result.stdout??'');report.commands.push(row);return result;}
console.log(JSON.stringify({candidate:candidate.candidate,root}));
try{
  report.inputs=copySelection(source,['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json',...candidate.changes.map(entry=>entry.path),'tests/commands/split/helpers.ts','tests/commands/stream-format/helpers.ts']);
  copyDependencies(join(source,'node_modules'));
  assert.equal(run('build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']).status,0);
  const pack=join(root,'pack');mkdirSync(pack);
  assert.equal(run('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]).status,0);
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.packageSha256=sha(readFileSync(tarball));assert.equal(report.packageSha256,candidate.expectedPackageSha256);
  const installed=join(root,'installed','node_modules','virtual-bash');mkdirSync(installed,{recursive:true});
  assert.equal(spawnSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',installed]).status,0);
  const moved=join(root,'moved');renameSync(join(root,'installed'),moved);
  for(const state of ['original','revised']){
    const frozen=state==='original'?candidate.base:candidate.candidate;
    for(const entry of candidate.changes)writeFileSync(join(source,entry.path),blob(entry.path,frozen));
    for(const [index,entry]of candidate.changes.entries()){
      const isConsumer=entry.path.endsWith('.mjs'),path=isConsumer?join(moved,'consumer.mjs'):join(source,entry.path);
      if(isConsumer)writeFileSync(path,blob(entry.path,frozen));
      const args=[...(!isConsumer?['--import','tsx']:[]),'--test','--test-reporter=tap','--test-concurrency=2',path];
      const result=run(`${state}-${index+1}`,args,isConsumer?moved:source);
      assert.equal(result.signal,null);assert.ok([0,1].includes(result.status));
      if(state==='revised')assert.equal(result.status,0,result.stderr);
      else assert.equal(result.status,1,'original count conflicts must remain observed');
    }
  }
  for(const entry of report.inputs)assert.equal(sha(readFileSync(join(source,entry.path))),entry.sha256,entry.path);
  report.productInputsUnchanged=true;report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,result:report.result,packageSha256:report.packageSha256,commands:report.commands,error:report.error}));}
