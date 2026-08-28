import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,cpSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copySelection,copyDependencies,blob,sha,git,node24,npm} from '../full-gate-20260827/unified76-driver/common.mjs';
import {capture,compare} from '../full-gate-20260827/unified76-driver/inventory.mjs';
import {directoryIdentity,fileIdentity} from '../full-gate-20260827/unified76-driver/launcher-v3/external.mjs';
import {account} from '../full-gate-20260827/account.mjs';

const binding=JSON.parse(readFileSync(new URL('./CANDIDATE.json',import.meta.url))),freeze=JSON.parse(readFileSync(new URL('./FREEZE.json',import.meta.url)));
const root=realpathSync(mkdtempSync(join(tmpdir(),'combined77-stage2-proof-'))),source=join(root,'source');mkdirSync(source);
const report={createdAt:new Date().toISOString(),root,candidate:binding.candidate,tree:binding.tree,commands:[],controls:[],wholeGateLaunched:false,independentCombinedAcceptance:false};
const repo=process.cwd(),node22='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',reviewer='02ccea66d1e7983056c0ed114f8842fbd7ec3255',reviewerPrefix='tests/integration/which-public-independent-20260828/';
const env={PATH:dirname(node24)+':/usr/bin:/bin',HOME:root,TMPDIR:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',npm_config_cache:join(root,'cache'),npm_config_userconfig:join(root,'npmrc'),npm_config_globalconfig:join(root,'global-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'http://127.0.0.1:1'};
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function run(label,args,cwd=source,executable=node24,extra={}){
  const result=spawnSync(executable,args,{cwd,env:{...env,...extra,PATH:dirname(executable)+':/usr/bin:/bin'},encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
  writeFileSync(join(root,label+'.stdout'),result.stdout??'',{flag:'wx'});writeFileSync(join(root,label+'.stderr'),result.stderr??'',{flag:'wx'});
  const record={label,executable,executableSha256:sha(readFileSync(executable)),args,cwd,status:result.status,signal:result.signal,error:result.error?.message,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')};
  if(args.includes('--test-reporter=tap'))record.accounting=account(result.stdout??'');report.commands.push(record);return result;
}
const requireStatus=(result,status=0)=>{assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,status,result.stderr);};
const permission=(executable,path)=>[executable===node22?'--experimental-permission':'--permission',`--allow-fs-read=${path}`,'--allow-worker','--unhandled-rejections=strict'];
try{
  assert.equal(git(['show','-s','--format=%P',binding.candidate]).toString().trim(),binding.base);assert.deepEqual(git(['diff','--name-only',binding.base,binding.candidate]).toString().trim().split('\n').sort(),binding.changes.map(row=>row.path).sort());
  for(const row of binding.changes)assert.equal(sha(blob(row.path,binding.candidate)),row.sha256);
  report.dependencies={main:await directoryIdentity(join(repo,'node_modules')),npm:await directoryIdentity(resolve(dirname(npm),'..'))};
  report.tools={node22:await fileIdentity(node22),node24:await fileIdentity(node24),tar:await fileIdentity('/usr/bin/tar')};
  const selected=['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json',...freeze.files.map(row=>row.path),'tests/commands/split/helpers.ts','tests/commands/stream-format/helpers.ts'];
  report.inputs=copySelection(source,selected,binding.candidate);copyDependencies(join(source,'node_modules'));
  assert.ok(existsSync(join(source,'tests/commands/stream-format/helpers.ts')));assert.ok(existsSync(join(source,'tests/commands/split/helpers.ts')));
  for(const path of ['tests/commands/split/helpers.ts','tests/commands/stream-format/helpers.ts'])assert.equal(sha(readFileSync(join(source,path))),sha(blob(path,binding.candidate)));
  const beforeBuild=await capture(source);requireStatus(run('build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']));
  const afterBuild=await capture(source);assert.deepEqual(compare(beforeBuild,{...afterBuild,entries:afterBuild.entries.filter(row=>row.path!=='dist'&&!row.path.startsWith('dist/'))}),[]);
  const pack=join(root,'pack');mkdirSync(pack);requireStatus(run('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]));
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.package=await fileIdentity(tarball);assert.notEqual(report.package.sha256,binding.basePackageSha256,'Stage2 product bytes must not be mislabeled with the historical WHICH-only tarball hash');
  for(const row of freeze.files.filter(row=>row.path.endsWith('.test.ts')))run('fixture-'+row.path.split('/').at(-2),['--import','tsx','--test','--test-reporter=tap','--test-concurrency=2',row.path]);
  const initial=join(root,'installed');mkdirSync(join(initial,'node_modules/virtual-bash'),{recursive:true});save(join(initial,'package.json'),{type:'module',private:true});
  execFileSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',join(initial,'node_modules/virtual-bash')],{timeout:30000,maxBuffer:1024*1024});
  for(const name of ['cohort.mjs','cases.json','types.json'])writeFileSync(join(initial,name),blob(reviewerPrefix+name,reviewer),{flag:'wx'});
  writeFileSync(join(initial,'stream-five.mjs'),blob('tests/plugins/stream-five-public/consumer.mjs',binding.candidate),{flag:'wx'});
  const types=JSON.parse(readFileSync(join(initial,'types.json')));for(const entry of types.cases)writeFileSync(join(initial,entry.id+'.mts'),entry.source,{flag:'wx'});
  writeFileSync(join(initial,'signal.mts'),readFileSync(new URL('./signal-consumer.mts.fixture',import.meta.url)),{flag:'wx'});
  const negatives=[['readonly','import type {CommandInvokeOptions} from "virtual-bash";const options:CommandInvokeOptions={};options.signal=undefined;','TS2540'],['null','import type {CommandInvokeOptions} from "virtual-bash";const options:CommandInvokeOptions={signal:null};void options;','TS2322'],['wrong-signal','import type {CommandInvokeOptions} from "virtual-bash";const options:CommandInvokeOptions={signal:"bad"};void options;','TS2322'],['nested-replace','import {agentCommands} from "virtual-bash";agentCommands({which:{replace:true}});','TS2353']];
  for(const[name,code]of negatives)writeFileSync(join(initial,'negative-'+name+'.mts'),code,{flag:'wx'});
  writeFileSync(join(initial,'smoke.mjs'),`import assert from'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import*as root from'virtual-bash';import*as contracts from'virtual-bash/contracts';import*as which from'virtual-bash/commands/which';assert.deepEqual(root.createAgentCommands().map(row=>row.name).sort(),${JSON.stringify(freeze.expectedNames)});assert.equal(root.createWhichCommand,which.createWhichCommand);assert.equal(root.CommandRegistry,contracts.CommandRegistry);const manifest=JSON.parse(readFileSync(new URL('./node_modules/virtual-bash/package.json',import.meta.url)));assert.deepEqual(manifest.dependencies??{},{});assert.equal(existsSync(new URL('./node_modules/virtual-bash/src',import.meta.url)),false);console.log('exact77/root/contracts/which/zero-deps');\n`,{flag:'wx'});
  const compiler=join(source,'node_modules/typescript/bin/tsc');const flags=['--noEmit','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','--lib','ES2023','--types','node','--typeRoots',join(source,'node_modules/@types')];
  report.layouts=[];
  for(const layout of ['installed','moved']){
    const consumer=layout==='installed'?initial:join(root,'moved consumer');if(layout==='moved')renameSync(initial,consumer);
    const packageRoot=join(consumer,'node_modules/virtual-bash'),before=await capture(consumer),packageBefore=await capture(packageRoot);
    if(layout==='installed'){report.packageFiles=packageBefore;report.packageManifestSha256=sha(readFileSync(join(packageRoot,'package.json')));assert.equal(report.packageManifestSha256,binding.packageManifestSha256);}
    for(const executable of [node22,node24])run(layout+'-which-'+(executable===node22?'22':'24'),[...permission(executable,consumer),'--test-reporter=tap','cohort.mjs'],consumer,executable,{PUBLIC_WHICH_LAYOUT:layout,PUBLIC_WHICH_PACKAGE_ROOT:packageRoot});
    requireStatus(run(layout+'-smoke',[...permission(node24,consumer),'smoke.mjs'],consumer));
    requireStatus(run(layout+'-strict-types',[compiler,...flags,...types.cases.map(entry=>entry.id+'.mts'),'signal.mts'],consumer));
    for(const[name,,code]of negatives){const result=run(layout+'-negative-'+name,[compiler,...flags,'negative-'+name+'.mts'],consumer);requireStatus(result,2);assert.deepEqual([...result.stdout.matchAll(/error (TS\d+):/gu)].map(row=>row[1]),[code]);}
    const resolution=run(layout+'-type-resolution',['--input-type=module','-e',`import assert from'node:assert/strict';import ts from${JSON.stringify(pathToFileURL(join(source,'node_modules/typescript/lib/typescript.js')).href)};import{realpathSync}from'node:fs';for(const[name,expected]of [['virtual-bash','dist/index.d.ts'],['virtual-bash/contracts','dist/contracts/index.d.ts'],['virtual-bash/commands/which','dist/commands/which/index.d.ts']]){const resolved=ts.resolveModuleName(name,${JSON.stringify(join(consumer,'signal.mts'))},{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext},ts.sys).resolvedModule;assert.ok(resolved);assert.equal(realpathSync(resolved.resolvedFileName),realpathSync(${JSON.stringify(packageRoot)}+'/'+expected));console.log(JSON.stringify({name,resolved:resolved.resolvedFileName}));}`],consumer);requireStatus(resolution);
    const denied=run(layout+'-source-denial',[...permission(node24,consumer),'--input-type=module','-e',`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(source,'src/index.ts'))});`],consumer);requireStatus(denied,1);assert.match(denied.stderr,/ERR_ACCESS_DENIED/u);
    if(layout==='moved')run('fixture-stream-five',['--test','--test-reporter=tap','stream-five.mjs'],consumer);
    assert.deepEqual(compare(before,await capture(consumer)),[]);assert.deepEqual(compare(report.packageFiles,await capture(packageRoot)),[]);report.layouts.push({layout,packageRoot,files:packageBefore.entries.length,immutable:true});
  }
  for(const[name,target,specifier]of [['root','dist/index.js','virtual-bash'],['contracts','dist/contracts/index.js','virtual-bash/contracts'],['which','dist/commands/which/index.js','virtual-bash/commands/which']]){
    const consumer=join(root,'missing-'+name);mkdirSync(join(consumer,'node_modules'),{recursive:true});cpSync(join(root,'moved consumer/node_modules/virtual-bash'),join(consumer,'node_modules/virtual-bash'),{recursive:true});save(join(consumer,'package.json'),{private:true,type:'module'});rmSync(join(consumer,'node_modules/virtual-bash',target));const result=run('missing-'+name,[...permission(node24,consumer),'--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],consumer);requireStatus(result,1);assert.match(result.stderr,/ERR_MODULE_NOT_FOUND/u);
  }
  const fixtures=report.commands.filter(row=>row.label.startsWith('fixture-'));report.fixtureTotals={pass:0,fail:0,skipped:0,todo:0,cancelled:0};assert.equal(fixtures.length,4);for(const row of fixtures){assert.equal(row.accounting.reconciled,true);for(const key of Object.keys(report.fixtureTotals))report.fixtureTotals[key]+=row.accounting.counts[key];}
  for(const row of fixtures)assert.equal(row.status,0,row.label);assert.deepEqual(report.fixtureTotals,{pass:68,fail:0,skipped:0,todo:0,cancelled:0});
  for(const row of report.commands.filter(row=>/^(installed|moved)-which-/u.test(row.label))){assert.equal(row.status,0,row.label);assert.equal(row.accounting.reconciled,true);assert.deepEqual(row.accounting.counts,{pass:18,fail:0,skipped:0,todo:0,cancelled:0});}
  assert.deepEqual(compare(afterBuild,await capture(source)),[]);assert.equal((await fileIdentity(tarball)).sha256,report.package.sha256);
  assert.deepEqual(await directoryIdentity(join(repo,'node_modules')),report.dependencies.main);assert.deepEqual(await directoryIdentity(resolve(dirname(npm),'..')),report.dependencies.npm);
  report.status='AUTHOR_COHERENT77_READINESS_PASS';
}catch(error){report.status='FAIL_OR_COMPATIBILITY_CONFLICT';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,candidate:binding.candidate,status:report.status,packageSha256:report.package?.sha256,fixtureTotals:report.fixtureTotals,commands:report.commands.map(({label,status,signal,accounting})=>({label,status,signal,counts:accounting?.counts})),error:report.error,wholeGateLaunched:false}));}
