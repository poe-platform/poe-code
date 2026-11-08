import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,renameSync,cpSync,rmSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {copySelection,copyDependencies,blob,sha,git,node24,npm} from '../../integration/full-gate-20260827/unified76-driver/common.mjs';
import {account} from '../../integration/full-gate-20260827/account.mjs';

const binding=JSON.parse(readFileSync(new URL('./CANDIDATE.json',import.meta.url)));
const reviewer='02ccea66d1e7983056c0ed114f8842fbd7ec3255';
const fixturePrefix='tests/integration/which-public-independent-20260828/';
const node22='/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const root=realpathSync(mkdtempSync(join(tmpdir(),'which77-public-')));
const source=join(root,'source');mkdirSync(source);
const report={startedAt:new Date().toISOString(),root,candidate:binding.candidate,tree:binding.tree,reviewerFreeze:reviewer,scope:'Author execution of unchanged frozen22 public families, not different-verifier acceptance',commands:[],controls:[],fullGateLaunched:false,helperSha256:sha(readFileSync(new URL(import.meta.url)))};
const environment={PATH:`${dirname(node24)}:/usr/bin:/bin`,HOME:root,TMPDIR:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1',npm_config_cache:join(root,'cache'),npm_config_userconfig:join(root,'npmrc'),npm_config_globalconfig:join(root,'global-npmrc'),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_registry:'http://127.0.0.1:1'};
function files(directory){
  const result={};const visit=folder=>{for(const name of readdirSync(folder).sort()){const path=join(folder,name),stat=lstatSync(path);assert.equal(stat.isSymbolicLink(),false,path);const key=relative(directory,path);if(stat.isDirectory()){result[key+'/']={kind:'directory',mode:stat.mode&0o777};visit(path);}else{assert.ok(stat.isFile());result[key]={kind:'file',mode:stat.mode&0o777,bytes:stat.size,sha256:sha(readFileSync(path))};}}};visit(directory);return result;
}
function run(label,executable,args,cwd=source,extra={}){
  const result=spawnSync(executable,args,{cwd,env:{...environment,...extra,PATH:`${dirname(executable)}:/usr/bin:/bin`},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  writeFileSync(join(root,label+'.stdout'),result.stdout??'',{flag:'wx'});writeFileSync(join(root,label+'.stderr'),result.stderr??'',{flag:'wx'});
  const row={label,executable,executableSha256:sha(readFileSync(executable)),args,cwd,status:result.status,signal:result.signal,error:result.error?.message,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')};
  if(args.includes('--test-reporter=tap'))row.accounting=account(result.stdout??'');report.commands.push(row);assert.equal(result.signal,null);assert.equal(result.error,undefined);return result;
}
const check=(name,operation)=>{operation();report.controls.push({name,status:'PASS'});};
const permission=(executable,directory)=>[executable===node22?'--experimental-permission':'--permission',`--allow-fs-read=${directory}`,'--allow-worker','--unhandled-rejections=strict'];
const save=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
try{
  assert.equal(git(['show','-s','--format=%P',binding.candidate]).toString().trim(),binding.base);
  assert.deepEqual(git(['diff','--name-only',binding.base,binding.candidate]).toString().trim().split('\n').sort(),binding.changes.map(row=>row.path).sort());
  for(const row of binding.changes)assert.equal(sha(blob(row.path,binding.candidate)),row.sha256);
  report.inputs=copySelection(source,['src','package.json','package-lock.json','README.md','tsconfig.json','tsconfig.build.json'],binding.candidate);
  copyDependencies(join(source,'node_modules'));
  const beforeBuild=files(source);report.beforeBuild=beforeBuild;
  assert.equal(run('build',node24,['node_modules/typescript/bin/tsc','-p','tsconfig.build.json']).status,0);
  const pack=join(root,'pack');mkdirSync(pack);
  assert.equal(run('pack',node24,[npm,'pack','--ignore-scripts','--json','--pack-destination',pack]).status,0);
  const tarball=join(pack,'virtual-bash-0.0.0.tgz');report.tarballSha256=sha(readFileSync(tarball));
  const sourceAfterBuild=files(source);report.sourceAfterBuild=sourceAfterBuild;
  for(const[path,value]of Object.entries(beforeBuild))assert.deepEqual(sourceAfterBuild[path],value,path);
  for(const path of Object.keys(sourceAfterBuild))assert.ok(Object.hasOwn(beforeBuild,path)||path==='dist/'||path.startsWith('dist/'),path);
  const initial=join(root,'installed');mkdirSync(initial);save(join(initial,'package.json'),{private:true,type:'module'});
  assert.equal(run('install-offline',node24,[npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',tarball],initial).status,0);
  const types=JSON.parse(blob(fixturePrefix+'types.json',reviewer));
  report.fixtureBindings=Object.fromEntries(['cohort.mjs','cases.json','types.json'].map(name=>[name,sha(blob(fixturePrefix+name,reviewer))]));
  for(const name of ['cohort.mjs','cases.json'])writeFileSync(join(initial,name),blob(fixturePrefix+name,reviewer),{flag:'wx'});
  for(const entry of types.cases)writeFileSync(join(initial,entry.id+'.mts'),entry.source,{flag:'wx'});
  const installed=join(initial,'node_modules/virtual-bash');
  report.packageFiles=files(installed);assert.equal(lstatSync(installed).isSymbolicLink(),false);
  const manifest=JSON.parse(readFileSync(join(installed,'package.json')));assert.deepEqual(manifest.dependencies??{},{});assert.equal(manifest.exports['./commands/which'].import,'./dist/commands/which/index.js');
  assert.equal(readFileSync(join(installed,'dist/commands/which/index.js'),'utf8').includes('createWhichCommands'),true);
  for(const path of Object.keys(report.packageFiles).filter(path=>path.startsWith('dist/')&&!path.endsWith('/')))assert.equal(report.packageFiles[path].sha256,sourceAfterBuild[path].sha256,path);
  const compiler=join(source,'node_modules/typescript/bin/tsc');
  const baseTypes=['--noEmit','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','--lib','ES2023','--types','node','--typeRoots',join(source,'node_modules/@types'),'--skipLibCheck'];
  for(const layout of ['installed','moved']){
    const consumer=layout==='installed'?initial:join(root,'moved consumer');if(layout==='moved')renameSync(initial,consumer);
    const packageRoot=join(consumer,'node_modules/virtual-bash');
    const expected=Object.fromEntries(Object.entries(report.packageFiles).filter(([,value])=>value.kind==='file').map(([path,value])=>[realpathSync(join(packageRoot,path)),value.sha256]));
    for(const name of ['cohort.mjs','cases.json'])expected[realpathSync(join(consumer,name))]=sha(readFileSync(join(consumer,name)));
    const guard=join(consumer,'guard.mjs');
    writeFileSync(guard,`import assert from'node:assert/strict';import{registerHooks}from'node:module';import{fileURLToPath}from'node:url';import{readFileSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';const expected=${JSON.stringify(expected)};const observed=new Map();registerHooks({load(url,context,next){if(url.startsWith('file:')){const path=realpathSync(fileURLToPath(url));assert.ok(Object.hasOwn(expected,path),'outside authenticated package/fixture: '+path);const hash=createHash('sha256').update(readFileSync(path)).digest('hex');assert.equal(hash,expected[path],path);observed.set(path,hash);}return next(url,context);}});process.once('beforeExit',()=>{const receipt={execPath:process.execPath,version:process.version,loaded:[...observed]};process.stdout.write('WHICH_AUTH '+JSON.stringify(receipt)+'\\n',error=>{if(error)throw error;});});\n`);
    const layoutBefore=files(consumer);report[layout+'Before']=layoutBefore;
    for(const executable of [node22,node24]){
      const label=layout+'-'+(executable===node22?'node22':'node24');
      const result=run(label,executable,[...permission(executable,consumer),'--import',guard,'--test-reporter=tap',join(consumer,'cohort.mjs')],consumer,{PUBLIC_WHICH_LAYOUT:layout,PUBLIC_WHICH_PACKAGE_ROOT:packageRoot});
      assert.equal(result.status,0,result.stderr);const counts=report.commands.at(-1).accounting;assert.equal(counts.reconciled,true);assert.equal(counts.counts.pass,18);assert.equal(counts.counts.fail,0);assert.equal(counts.counts.skipped,0);
      const traces=result.stdout.split('\n').filter(line=>line.includes('WHICH_AUTH ')).map(line=>JSON.parse(line.slice(line.indexOf('WHICH_AUTH ')+11)));
      assert.ok(traces.some(row=>row.loaded.some(([path])=>path===realpathSync(join(packageRoot,'dist/commands/which/index.js')))));
      for(const trace of traces)assert.equal(realpathSync(trace.execPath),realpathSync(executable));report.controls.push({name:label+' actual loaded package/root/subpath bindings',status:'PASS',traces});
    }
    for(const entry of types.cases)assert.equal(run(layout+'-'+entry.id,node24,[compiler,...baseTypes,join(consumer,entry.id+'.mts')],consumer).status,0);
    const resolution=run(layout+'-type-resolution',node24,['--input-type=module','-e',`import assert from'node:assert/strict';import ts from${JSON.stringify(pathToFileURL(join(source,'node_modules/typescript/lib/typescript.js')).href)};import{realpathSync}from'node:fs';const options={module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext};for(const [name,expected]of [['virtual-bash','dist/index.d.ts'],['virtual-bash/commands/which','dist/commands/which/index.d.ts']]){const result=ts.resolveModuleName(name,${JSON.stringify(join(consumer,'T01.mts'))},options,ts.sys).resolvedModule;assert.ok(result);assert.equal(realpathSync(result.resolvedFileName),realpathSync(${JSON.stringify(packageRoot)}+'/'+expected));console.log(JSON.stringify({name,path:result.resolvedFileName}));}`],consumer);assert.equal(resolution.status,0);
    const denied=run(layout+'-source-denial',node24,[...permission(node24,consumer),'--input-type=module','-e',`import{readFileSync}from'node:fs';readFileSync(${JSON.stringify(join(source,'src/index.ts'))});`],consumer);assert.equal(denied.status,1);assert.match(denied.stderr,/ERR_ACCESS_DENIED/u);
    assert.deepEqual(files(packageRoot),report.packageFiles);assert.deepEqual(files(consumer),layoutBefore);
    report.controls.push({name:layout+' source denial, strict types, resolution and package/consumer immutability',status:'PASS'});
  }
  const moved=join(root,'moved consumer');
  for(const name of ['root-runtime','leaf-runtime','leaf-export','root-types','nested-replace']){
    const consumer=join(root,'negative-'+name);mkdirSync(consumer);mkdirSync(join(consumer,'node_modules'));cpSync(join(moved,'node_modules/virtual-bash'),join(consumer,'node_modules/virtual-bash'),{recursive:true});save(join(consumer,'package.json'),{private:true,type:'module'});
    const product=join(consumer,'node_modules/virtual-bash');
    if(name==='root-runtime'||name==='leaf-runtime')rmSync(join(product,name==='root-runtime'?'dist/index.js':'dist/commands/which/index.js'));
    if(name==='leaf-export'){const changed=JSON.parse(readFileSync(join(product,'package.json')));delete changed.exports['./commands/which'];writeFileSync(join(product,'package.json'),JSON.stringify(changed));}
    if(name==='root-types')rmSync(join(product,'dist/index.d.ts'));
    if(name==='root-types'||name==='nested-replace'){
      const code=name==='root-types'?"import { createWhichCommand } from 'virtual-bash'; createWhichCommand();":"import { agentCommands } from 'virtual-bash'; agentCommands({ which: { replace: true } });";
      writeFileSync(join(consumer,'negative.mts'),code);const result=run('negative-'+name,node24,[compiler,...baseTypes,join(consumer,'negative.mts')],consumer);assert.equal(result.status,2);assert.match(result.stdout,name==='root-types'?/TS7016|TS2307/u:/TS2353/u);
    }else{const specifier=name==='root-runtime'?'virtual-bash':'virtual-bash/commands/which';const result=run('negative-'+name,node24,[...permission(node24,consumer),'--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],consumer);assert.equal(result.status,1);assert.match(result.stderr,name==='leaf-export'?/ERR_PACKAGE_PATH_NOT_EXPORTED/u:/ERR_MODULE_NOT_FOUND/u);}
    report.controls.push({name:name+' cannot fall back to source or weaken options',status:'PASS'});
  }
  assert.deepEqual(files(source),sourceAfterBuild);assert.deepEqual(files(join(moved,'node_modules/virtual-bash')),report.packageFiles);assert.equal(sha(readFileSync(tarball)),report.tarballSha256);
  report.result='AUTHOR_PUBLIC22_FAMILIES_PASS';
}catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save(join(root,'REPORT.json'),report);console.log(JSON.stringify({root,candidate:binding.candidate,result:report.result,tarballSha256:report.tarballSha256,commands:report.commands.map(({label,status,signal,accounting})=>({label,status,signal,counts:accounting?.counts})),error:report.error,fullGateLaunched:false}));}
