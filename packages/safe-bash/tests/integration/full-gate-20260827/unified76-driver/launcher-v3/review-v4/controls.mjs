import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,existsSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PRODUCT,parseArgs} from '../policy.mjs';
import {parseReviewArgs} from '../review-build-types.mjs';
import {verifyDriverSeal,requireRelease} from '../admission.mjs';
import {readProfile} from '../profile.mjs';
import {createBuildAudit,readBuildAudit} from '../build-types.mjs';
import {attachProcessObserver} from '../process-observer.mjs';
import {node24,directory,copyDependencies,sha} from '../common.mjs';
import {BOUNDS} from '../policy.mjs';

const owned=dirname(fileURLToPath(import.meta.url)),work=realpathSync(mkdtempSync(join(tmpdir(),'unified76-review-v4-controls-')));
const report={candidate:PRODUCT,work,createdAt:new Date().toISOString(),results:[],wholeGateLaunched:false};
const check=async(name,operation)=>{try{report.results.push({name,status:'PASS',detail:await operation()});}catch(error){report.results.push({name,status:'FAIL',error:error.stack});}};
await check('explicit review-only CLI and unchanged release gate',async()=>{
  assert.equal(parseReviewArgs(['--candidate',PRODUCT,'--review-build-types','/tmp/unified76-build-types-review-example']).candidate,PRODUCT);
  for(const args of [[],['--candidate','HEAD','--review-build-types','/tmp/unified76-build-types-review-example'],['--candidate',PRODUCT,'--run','/tmp/unified76-build-types-review-example'],['--candidate',PRODUCT,'--execute','/tmp/unified76-build-types-review-example']])assert.throws(()=>parseReviewArgs(args));
  assert.throws(()=>parseArgs(['--candidate',PRODUCT,'--review-build-types','/tmp/unified76-build-types-review-example']));
  assert.throws(()=>requireRelease({},verifyDriverSeal(),readProfile()));return{negativeRoutes:6};
});
await check('imports are inert; real phase implementation is shared',async()=>{
  const child=spawnSync(node24,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../review-build-types.mjs',import.meta.url).href)});await import(${JSON.stringify(new URL('../run.mjs',import.meta.url).href)});console.log('inert');`],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'inert\n');
  for(const name of ['execute.mjs','review-build-types.mjs']){const text=readFileSync(join(directory,name),'utf8');assert.equal((text.match(/await runBuildTypes\(/gu)||[]).length,1);assert.ok(text.includes('createPhaseRunner('));}
  const seal=verifyDriverSeal();return{driverSha256:sha(JSON.stringify(seal)),files:Object.keys(seal.files).length};
});
await check('two actual compiler builds reject the one-build receipt',async()=>{
  const source=join(work,'tiny-source'),temporary=join(work,'tiny-audit');mkdirSync(source);mkdirSync(join(temporary,'harness'),{recursive:true});copyDependencies(join(source,'node_modules'));
  writeFileSync(join(source,'tsconfig.build.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',outDir:'dist',types:[]},files:['input.ts']}));
  writeFileSync(join(source,'input.ts'),'export const value: number = 7;\n');
  const audit=createBuildAudit(source,temporary);assert.deepEqual(readBuildAudit(audit),[]);
  const commands=[];
  for(const attempt of [1,2]){
    const args=['--import',audit.preload,join(source,'node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'];
    const result=spawnSync(node24,args,{cwd:source,env:{PATH:dirname(node24)+':/usr/bin:/bin',...audit.environment},encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr+result.stdout);commands.push({attempt,args,status:result.status});
    if(attempt===1)assert.equal(readBuildAudit(audit).length,1);
  }
  assert.ok(existsSync(join(source,'dist/input.js')));assert.throws(()=>readBuildAudit(audit),/duplicate driver production build/);
  assert.equal(readBuildAudit(audit,2).length,2);
  const prior=readFileSync(audit.preload);writeFileSync(audit.preload,'tampered');assert.throws(()=>readBuildAudit(audit,2),/preload changed/);writeFileSync(audit.preload,prior);
  return{commands,actualCompilerBuilds:2,productCandidateBuilds:0,duplicateRejected:true,preloadMutationRejected:true};
});
await check('contained link uses trusted outer observer with target fences intact',async()=>{
  const temporary=join(work,'contained');mkdirSync(temporary);const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git',repo=join(temporary,'objects');
  execFileSync(git,['init','--bare','--quiet','--template=',repo]);
  const data=Buffer.from('contained frozen bytes\n'),link=Buffer.from('payload');
  const object=bytes=>execFileSync(git,['--git-dir',repo,'hash-object','-w','--stdin'],{input:bytes}).toString().trim();
  const entries=[{path:'fixture-link',mode:'120000',blob:object(link),bytes:link.length},{path:'payload',mode:'100644',blob:object(data),bytes:data.length}];
  const destination=join(temporary,'result'),config=join(temporary,'config.json'),sandbox=join(temporary,'containment.sb'),forbidden=join(work,'FORBIDDEN-WRITE');
  const policy='(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath '+JSON.stringify(temporary)+') (literal "/dev/null"))\n(deny network*)\n(deny process-exec)\n(allow process-exec '+[node24,git,'/bin/ps','/bin/ln'].map(path=>'(literal '+JSON.stringify(path)+')').join(' ')+')\n';
  writeFileSync(sandbox,policy);writeFileSync(config,JSON.stringify({forbidden,input:{git,repository:repo,candidate:PRODUCT,entries,destination,environment:{PATH:'/usr/bin:/bin'},bounds:{...BOUNDS,archiveEntries:2,archiveBytes:data.length+link.length}}}));
  const token=randomUUID(),args=['-f',sandbox,node24,join(owned,'contained-probe.mjs'),config];
  const child=spawn('/usr/bin/sandbox-exec',args,{cwd:temporary,env:{PATH:dirname(node24)+':/usr/bin:/bin',UNIFIED76_OBSERVER_TOKEN:token},detached:true,stdio:['ignore','pipe','pipe','ipc']});
  const observer=attachProcessObserver(child,token);let stdout='',stderr='',forced=false;
  child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
  const timeout=setTimeout(()=>{forced=true;child.kill('SIGKILL');},15000);
  const result=await new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(status,signal)=>resolve({status,signal}));});clearTimeout(timeout);
  const observed=observer.finish();report.contained={args,policy,policySha256:sha(policy),stdout,stderr,result,forced,observed};
  assert.equal(forced,false);assert.equal(result.signal,null);assert.equal(result.status,0,stderr);assert.equal(observed.groups.length,1);assert.deepEqual(observed.survivors,[]);
  assert.equal(existsSync(forbidden),false);assert.equal(JSON.parse(stdout).receipt.closed,true);return report.contained;
});
report.finishedAt=new Date().toISOString();report.summary={pass:report.results.filter(row=>row.status==='PASS').length,fail:report.results.filter(row=>row.status==='FAIL').length};
writeFileSync(join(work,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({work,summary:report.summary,wholeGateLaunched:false}));if(report.summary.fail)process.exitCode=1;
