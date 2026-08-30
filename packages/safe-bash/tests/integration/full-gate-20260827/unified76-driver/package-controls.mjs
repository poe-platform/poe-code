import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidate,directory,blob,node24,save,sha,repository} from './common.mjs';
import {probeGuardedRuntime} from '../runtime-profile-20260827/profile.mjs';
import {createTreeGuard} from '../integrity-73/tree.mjs';

const root=realpathSync(process.argv[2]),source=join(root,'source'),consumer=join(root,'moved'),version=process.argv[3]??'v1',capture=join(root,'package-controls-'+version);assert.match(version,/^v[0-9]+$/u);mkdirSync(capture);
const rows=[];const packageRoot=join(consumer,'node_modules/virtual-bash'),guard=createTreeGuard(packageRoot);
assert.equal(sha(readFileSync(join(root,'pack/virtual-bash-0.0.0.tgz'))),candidate.expectedPackageSha256);
const test=(name,callback)=>{try{callback();rows.push({name,status:'PASS'});}catch(error){rows.push({name,status:'FAIL',error:error.stack});}};
const environment={PATH:`${dirname(node24)}:/usr/bin:/bin`,HOME:root,TMPDIR:root,LANG:'C',LC_ALL:'C',TZ:'UTC',TSX_DISABLE_CACHE:'1'};
const run=(label,args,cwd=consumer)=>{const result=spawnSync(node24,args,{cwd,env:environment,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});save(join(capture,label+'.json'),{status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,args,cwd});return result;};
for(const[name,target]of [['public.mjs',`unified76-public-${version}.mjs`],['consumer.mts.fixture',`unified76-consumer-${version}.mts`],['negative.mts.fixture',`unified76-negative-${version}.mts`]])writeFileSync(join(consumer,target),readFileSync(join(directory,name)),{flag:'wx'});
test('literal76 root/all subpaths and five workflows in moved package with permission fence',()=>{const result=run('public',['--permission',`--allow-fs-read=${consumer}`,'--allow-worker','--unhandled-rejections=strict',`unified76-public-${version}.mjs`]);assert.equal(result.status,0,result.stderr);const observed=JSON.parse(result.stdout);assert.equal(observed.count,76);assert.equal(observed.workflows.length,5);});
const compiler=join(source,'node_modules/typescript/bin/tsc'),args=['--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--types','node','--typeRoots',join(source,'node_modules/@types'),'--traceResolution'];
test('strict public consumer uses installed declaration files',()=>{const result=run('types',[compiler,...args,`unified76-consumer-${version}.mts`]);assert.equal(result.status,0,result.stdout);assert.ok(result.stdout.includes(packageRoot+'/dist/index.d.ts'));assert.equal(result.stdout.includes(source+'/src/'),false);});
test('negative public missing export/nested authority exact diagnostics',()=>{const result=run('negative-types',[compiler,...args,`unified76-negative-${version}.mts`]);assert.equal(result.status,2);assert.deepEqual([...result.stdout.matchAll(/error (TS\d+):/gu)].map(match=>match[1]),['TS2305','TS2353','TS2353']);});
for(const[name,specifier,file]of [['root','virtual-bash','dist/index.js'],['contracts','virtual-bash/contracts','dist/contracts/index.js']])test('missing '+name+' cannot fall back to source',()=>{const missing=join(root,'package-missing-'+name+'-'+version);mkdirSync(missing);cpSync(packageRoot,join(missing,'node_modules/virtual-bash'),{recursive:true});rmSync(join(missing,'node_modules/virtual-bash',file));const result=run('missing-'+name,['--input-type=module','-e',`await import(${JSON.stringify(specifier)});`],missing);assert.equal(result.status,1);assert.match(result.stderr,/ERR_MODULE_NOT_FOUND/u);});
test('actual guarded Node24 TS/CommonJS and direct/PATH child profile',()=>{
 const harness=join(root,'runtime-harness-'+version);mkdirSync(harness);const guardPath=join(harness,'guard.mjs');writeFileSync(guardPath,blob('tests/integration/full-gate-20260827/combined-8670ebe8/import-guard.mjs'));
 const expectedSource=Object.fromEntries(['src/commands/execution.ts','src/commands/env-split.ts'].map(path=>[path,sha(blob(path))]));
 const result=probeGuardedRuntime({executable:node24,root,source,harness,guard:guardPath,expectedSource,environment});save(join(capture,'runtime-probe.json'),result);assert.equal(result.status,0,result.reason);
});
test('package bytes unchanged after all controls',()=>{assert.deepEqual(guard.check().changes,[]);assert.equal(sha(readFileSync(join(root,'pack/virtual-bash-0.0.0.tgz'))),candidate.expectedPackageSha256);});
const report={candidate:candidate.candidate,packageSha256:candidate.expectedPackageSha256,createdAt:new Date().toISOString(),rows,scope:'author bounded package/loader controls, not full driver dispatch or independent public74/75/76 acceptance'};save(join(capture,'REPORT.json'),report);console.log(JSON.stringify({capture,pass:rows.filter(row=>row.status==='PASS').length,fail:rows.filter(row=>row.status==='FAIL')}));if(rows.some(row=>row.status==='FAIL'))process.exitCode=1;
