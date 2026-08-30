import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,cpSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {copySelection,copyDependencies,blob,sha,git,node24,npm} from '../full-gate-20260827/unified76-driver/launcher-v3/common.mjs';
import {capture,compare} from '../full-gate-20260827/unified76-driver/launcher-v3/inventory.mjs';
import {directoryIdentity,fileIdentity} from '../full-gate-20260827/unified76-driver/launcher-v3/external.mjs';
import {supervise} from '../full-gate-20260827/unified76-driver/launcher-v3/supervise.mjs';
import {accountFile} from '../full-gate-20260827/unified76-driver/launcher-v3/tap.mjs';

const own=dirname(fileURLToPath(import.meta.url)),repo=resolve(own,'../../..');
const binding=JSON.parse(readFileSync(join(own,'CANDIDATE.json'))),freeze=JSON.parse(readFileSync(join(own,'FREEZE-V2.json')));
const fixtureRevision="bcb6481e354361764face7b2c8a1cc61786f0988";
const root=realpathSync(mkdtempSync(join(tmpdir(),'timeout78-public-author-v3-'))),source=join(root,'source');mkdirSync(source);
const output=join(root,'logs');mkdirSync(output);
const report={createdAt:new Date().toISOString(),root,candidate:binding.candidate,source:binding.source,commands:[],wholeGateLaunched:false,independentPublicAcceptance:false,privateAccess:false,nativeExecutions:0};
const node22='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const environment={PATH:dirname(node24)+':/usr/bin:/bin',HOME:root,TMPDIR:root,TMP:root,TEMP:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',NO_COLOR:'1',npm_config_cache:join(root,'npm-cache'),npm_config_userconfig:join(root,'npmrc'),npm_config_globalconfig:join(root,'global-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'http://127.0.0.1:1'};
writeFileSync(environment.npm_config_userconfig,'',{flag:'wx'});writeFileSync(environment.npm_config_globalconfig,'',{flag:'wx'});
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const text=path=>{const bytes=readFileSync(path);assert.ok(bytes.length<=8*1024*1024,'bounded result input');return bytes.toString();};
async function run(label,args,cwd=source,executable=node24,expected=0){
  const stdout=join(output,label+'.stdout'),stderr=join(output,label+'.stderr');
  const result=await supervise(executable,args,{cwd,env:environment,stdout,stderr,timeoutMs:180000,maxOutputBytes:8*1024*1024,observeSockets:true});
  const row={label,...result,expected,stdout,stderr,stdoutSha256:sha(readFileSync(stdout)),stderrSha256:sha(readFileSync(stderr))};
  if(args.includes('--test-reporter=tap'))row.accounting=await accountFile(stdout);report.commands.push(row);
  assert.equal(result.status,expected,label+': '+text(stderr));assert.equal(result.signal,null);assert.equal(result.clean,true,label+' owned cleanup');assert.equal(result.closed,true);assert.deepEqual(result.survivors,[]);assert.deepEqual(result.signals,[]);
  return row;
}
const permission=(executable,consumer)=>[executable===node22?'--experimental-permission':'--permission',`--allow-fs-read=${consumer}`,'--allow-worker','--unhandled-rejections=strict'];
try{
  const seal=JSON.parse(readFileSync(join(own,'EXECUTOR-SEAL-V3.json')));for(const[path,expected]of Object.entries(seal.files))assert.equal(sha(readFileSync(join(repo,path))),expected,'executor input drift '+path);
  assert.equal(git(['rev-parse',binding.candidate+'^{tree}']).toString().trim(),binding.tree);
  assert.equal(sha(git(['cat-file','commit',binding.candidate])),binding.rawCommitSha256);
  assert.deepEqual(git(['diff','--name-only',binding.base,binding.candidate]).toString().trim().split('\n').sort(),binding.changes.map(row=>row.path).sort());
  for(const row of binding.changes){assert.equal(sha(blob(row.path,binding.candidate)),row.sha256);assert.deepEqual(blob(row.path,row.revision),blob(row.path,binding.candidate));}
  report.tools=await Promise.all([node22,node24,'/Applications/Xcode.app/Contents/Developer/usr/bin/git','/usr/bin/tar'].map(fileIdentity));
  assert.deepEqual(report.tools,seal.tools,'tool identities changed after executor seal');
  report.dependencies={main:await directoryIdentity(join(repo,'node_modules')),npm:await directoryIdentity(resolve(dirname(npm),'..'))};
  const selected=['src','README.md','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','tests/commands/split/helpers.ts','tests/commands/stream-format/helpers.ts'];
  report.inputs=copySelection(source,selected,binding.candidate);report.dependencies.copy=copyDependencies(join(source,'node_modules'));
  assert.equal(existsSync(join(source,'src/commands/xan')),false);assert.equal(existsSync(join(source,'AGENTS.md')),false);
  report.fixtureOverlay=[];
  for(const row of freeze.fixtures){const bytes=blob(row.path,fixtureRevision);assert.equal(sha(bytes),row.afterSha256);assert.equal(sha(blob(row.path,binding.base)),row.beforeSha256);mkdirSync(dirname(join(source,row.path)),{recursive:true});writeFileSync(join(source,row.path),bytes,{flag:'wx'});report.fixtureOverlay.push({path:row.path,revision:fixtureRevision,sha256:sha(bytes),role:row.role});}
  const beforeBuild=await capture(source);
  await run('build',['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']);
  const afterBuild=await capture(source);assert.deepEqual(compare(beforeBuild,{...afterBuild,entries:afterBuild.entries.filter(row=>row.path!=='dist'&&!row.path.startsWith('dist/'))}),[]);
  const packDirectory=join(root,'pack');mkdirSync(packDirectory);await run('pack',[npm,'pack','--ignore-scripts','--json','--pack-destination',packDirectory]);
  const tarball=join(packDirectory,'virtual-bash-0.0.0.tgz');report.package=await fileIdentity(tarball);
  report.packMetadata=JSON.parse(text(join(output,'pack.stdout')))[0];assert.equal(report.packMetadata.filename,'virtual-bash-0.0.0.tgz');assert.ok(report.packMetadata.files.every(row=>row.path==='package.json'||row.path==='README.md'||row.path.startsWith('dist/')));
  for(const row of freeze.fixtures.filter(row=>row.path.endsWith('.test.ts')))await run('fixture-'+row.path.split('/').at(-2),['--import','tsx','--test','--test-reporter=tap','--test-concurrency=2',row.path]);
  const initial=join(root,'installed'),packagePath=join(initial,'node_modules/virtual-bash');mkdirSync(packagePath,{recursive:true});save(join(initial,'package.json'),{private:true,type:'module'});
  execFileSync('/usr/bin/tar',['-xf',tarball,'--strip-components=1','-C',packagePath],{env:environment,timeout:30000,maxBuffer:1024*1024});
  for(const name of ['public.mjs','names.mjs'])writeFileSync(join(initial,name),readFileSync(join(own,name==='public.mjs'?'public-v3.mjs':name)),{flag:'wx'});
  writeFileSync(join(initial,'stream-five.mjs'),blob('tests/plugins/stream-five-public/consumer.mjs',fixtureRevision),{flag:'wx'});
  const typeModule=await import(pathToFileURL(join(repo,'tests/commands/timeout-independent-20260828/public-integration-freeze-v1/types.mjs')));
  for(const row of typeModule.consumers)writeFileSync(join(initial,row.id+'.mts'),row.source,{flag:'wx'});
  const compiler=join(source,'node_modules/typescript/bin/tsc'),flags=['--noEmit','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',join(source,'node_modules/@types')];
  report.layouts=[];
  for(const layout of ['installed','moved']){
    const consumer=layout==='installed'?initial:join(root,'moved consumer');if(layout==='moved')renameSync(initial,consumer);
    const packageRoot=join(consumer,'node_modules/virtual-bash'),before=await capture(consumer),packageBefore=await capture(packageRoot);
    const manifest=JSON.parse(readFileSync(join(packageRoot,'package.json')));assert.deepEqual(manifest.dependencies??{},{});assert.equal(sha(readFileSync(join(packageRoot,'package.json'))),binding.packageManifestSha256);
    assert.deepEqual(manifest.exports['./commands/timeout'],{types:'./dist/commands/timeout/index.d.ts',import:'./dist/commands/timeout/index.js'});
    for(const executable of [node22,node24]){const row=await run(layout+'-runtime-'+(executable===node22?'22':'24'),[...permission(executable,consumer),'--test-reporter=tap','public.mjs'],consumer,executable);assert.equal(row.accounting.reconciled,true);assert.deepEqual(row.accounting.counts,{pass:13,fail:0,skipped:0,todo:0,cancelled:0});}
    await run(layout+'-strict-types',[compiler,...flags,...typeModule.consumers.filter(row=>row.expected==='accept').map(row=>row.id+'.mts')],consumer);
    for(const row of typeModule.consumers.filter(row=>row.expected==='reject')){
      const result=await run(layout+'-negative-'+row.id,[compiler,...flags,row.id+'.mts'],consumer,node24,2);const diagnostics=text(result.stdout);assert.deepEqual([...diagnostics.matchAll(/error TS(\d+):/gu)].map(match=>Number(match[1])),[row.code]);for(const term of row.messageTerms)assert.ok(diagnostics.includes(term),term);
    }
    await run(layout+'-resolution',['--input-type=module','-e',`import assert from'node:assert/strict';import ts from${JSON.stringify(pathToFileURL(join(source,'node_modules/typescript/lib/typescript.js')).href)};import{realpathSync}from'node:fs';for(const[name,expected]of [['virtual-bash','dist/index.d.ts'],['virtual-bash/contracts','dist/contracts/index.d.ts'],['virtual-bash/commands/timeout','dist/commands/timeout/index.d.ts']]){const result=ts.resolveModuleName(name,${JSON.stringify(join(consumer,'T01.mts'))},{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext},ts.sys).resolvedModule;assert.ok(result);assert.equal(realpathSync(result.resolvedFileName),realpathSync(${JSON.stringify(packageRoot)}+'/'+expected));console.log(name);}`],consumer);
    const denied=await run(layout+'-source-denial',[...permission(node24,consumer),'--input-type=module','-e',`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(source,'src/index.ts'))});`],consumer,node24,1);assert.ok(text(denied.stderr).includes('ERR_ACCESS_DENIED'));assert.ok(text(denied.stderr).includes(join(source,'src/index.ts')));
    if(layout==='moved')await run('fixture-stream-five',['--test-reporter=tap','stream-five.mjs'],consumer);
    assert.deepEqual(compare(before,await capture(consumer)),[]);assert.deepEqual(compare(packageBefore,await capture(packageRoot)),[]);
    report.layouts.push({layout,packageRoot,files:packageBefore.entries.length,manifestSha256:sha(readFileSync(join(packageRoot,'package.json'))),immutable:true});
    if(layout==='installed')report.packageFiles=packageBefore;
  }
  for(const[name,target,specifier]of [['root','dist/index.js','virtual-bash'],['contracts','dist/contracts/index.js','virtual-bash/contracts'],['timeout','dist/commands/timeout/index.js','virtual-bash/commands/timeout']]){
    const consumer=join(root,'missing-'+name);mkdirSync(join(consumer,'node_modules'),{recursive:true});cpSync(join(root,'moved consumer/node_modules/virtual-bash'),join(consumer,'node_modules/virtual-bash'),{recursive:true});save(join(consumer,'package.json'),{private:true,type:'module'});rmSync(join(consumer,'node_modules/virtual-bash',target));
    const result=await run('missing-'+name,[...permission(node24,consumer),'--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],consumer,node24,1);assert.ok(text(result.stderr).includes('ERR_MODULE_NOT_FOUND'));
  }
  report.fixtures=report.commands.filter(row=>row.label.startsWith('fixture-')).map(row=>({label:row.label,counts:row.accounting.counts,reconciled:row.accounting.reconciled}));assert.equal(report.fixtures.length,5);for(const row of report.fixtures){assert.equal(row.reconciled,true);for(const key of ['fail','skipped','todo','cancelled'])assert.equal(row.counts[key],0);}
  assert.deepEqual(compare(afterBuild,await capture(source)),[]);assert.equal((await fileIdentity(tarball)).sha256,report.package.sha256);
  assert.deepEqual(await directoryIdentity(join(repo,'node_modules')),report.dependencies.main);assert.deepEqual(await directoryIdentity(resolve(dirname(npm),'..')),report.dependencies.npm);
  assert.deepEqual(await Promise.all(report.tools.map(row=>fileIdentity(row.origin))),report.tools,'tool identities changed during author run');
  report.status='AUTHOR_TIMEOUT78_PUBLIC_PASS';
}catch(error){report.status='AUTHOR_FAIL_OR_HOLD';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,candidate:binding.candidate,status:report.status,packageSha256:report.package?.sha256,commands:report.commands.map(row=>({label:row.label,status:row.status,clean:row.clean,counts:row.accounting?.counts})),error:report.error,wholeGateLaunched:false}));}
