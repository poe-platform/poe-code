import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readlinkSync,readdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ARCHIVE_PATH_PROFILE,validateEntries,extractCommitted} from '../transport.mjs';
import {BOUNDS,PRODUCT} from '../policy.mjs';
import {readProfile} from '../profile.mjs';
import {verifyArchive} from '../inventory.mjs';
import {verifyDriverSeal} from '../admission.mjs';
import {node24,repository,sha} from '../common.mjs';

const owned=dirname(fileURLToPath(import.meta.url));
const work=realpathSync(mkdtempSync(join(tmpdir(),'unified76-review-v5-controls-')));
const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const report={candidate:PRODUCT,work,startedAt:new Date().toISOString(),results:[],wholeGateLaunched:false};
const check=async(name,operation)=>{try{report.results.push({name,status:'PASS',detail:await operation()});}catch(error){report.results.push({name,status:'FAIL',error:error.stack});}};
const boundsFor=entries=>({...BOUNDS,archiveEntries:entries.length,archiveBytes:entries.reduce((total,row)=>total+row.bytes,0)});
const entry=path=>({path,mode:'100644',blob:'1'.repeat(40),bytes:1});

await check('pinned POSIX profile and unchanged complete candidate membership',async()=>{
  const profile=readProfile();
  assert.equal(profile.platform,ARCHIVE_PATH_PROFILE.platform);assert.equal(profile.arch,ARCHIVE_PATH_PROFILE.arch);
  assert.deepEqual(ARCHIVE_PATH_PROFILE,{platform:'darwin',arch:'arm64',syntax:'posix',separator:'/'});
  assert.equal(validateEntries(profile.scopeInputs).entries,37397);
  const literal=profile.scopeInputs.filter(row=>row.path.includes('\\'));
  assert.deepEqual(literal.map(row=>row.path),[
    'tests/commands/filesystem-inspection-stress/tree/evidence/final-436bda3/harness/derived/native-fixtures/controls/back\\slash',
    'tests/commands/filesystem-inspection-stress/tree/sealed/native-fixtures/controls/back\\slash',
  ]);
  for(const row of literal){assert.equal(row.blob,'63d8dbd40c23542e740659a7168a0ce3138ea748');assert.equal(row.bytes,1);assert.equal(row.mode,'100644');}
  return{literal,completeEntries:profile.scopeInputs.length,completeBytes:profile.closure.bytes};
});
await check('slash traversal NUL absolute git and symlink-ancestor refusals remain',async()=>{
  const rejected=['../escape','/absolute','a/../../escape','a/../escape','a//file','./file','a/./file','bad\0name','.git/config','a/.git/config'];
  for(const path of rejected){const entries=[entry(path)];assert.throws(()=>validateEntries(entries,boundsFor(entries)));}
  const duplicate=[entry('same'),entry('same')];assert.throws(()=>validateEntries(duplicate,boundsFor(duplicate)));
  const linkAncestor=[{...entry('link'),mode:'120000'},entry('link/child')];assert.throws(()=>validateEntries(linkAncestor,boundsFor(linkAncestor)),/symlink ancestor/);
  for(const path of ['back\\slash','..\\literal','C:\\literal']){const entries=[entry(path)];assert.equal(validateEntries(entries,boundsFor(entries)).entries,1);assert.equal(entries[0].path,path);}
  for(const override of [{...ARCHIVE_PATH_PROFILE,platform:'win32'},{...ARCHIVE_PATH_PROFILE,platform:'linux'},{...ARCHIVE_PATH_PROFILE,syntax:'win32',separator:'\\'},{...ARCHIVE_PATH_PROFILE,separator:'\\'},{...ARCHIVE_PATH_PROFILE,arch:'x64'}]){
    const entries=[entry('back\\slash')];assert.throws(()=>validateEntries(entries,boundsFor(entries),override),/pinned POSIX archive path profile/);
    await assert.rejects(extractCommitted({git:'/never-execute',repository:'/never-read',candidate:PRODUCT,entries,destination:join(work,'must-not-exist'),environment:{},bounds:boundsFor(entries),pathProfile:override}),/pinned POSIX archive path profile/);
  }
  assert.equal(existsSync(join(work,'must-not-exist')),false);return{unsafePathRefusals:12,literalPositives:3,foreignProfiles:5,foreignExtractionRefusals:5,otherPlatformsExecuted:false};
});
await check('actual fixed backslash members extract without reinterpretation',async()=>{
  const profile=readProfile(),entries=profile.scopeInputs.filter(row=>row.path.includes('\\'));
  const destination=join(work,'actual-candidate');
  const receipt=await extractCommitted({git,repository,candidate:PRODUCT,entries,destination,environment:{PATH:'/usr/bin:/bin'},bounds:boundsFor(entries)});
  const verified=await verifyArchive(destination,entries);
  for(const row of entries){const bytes=readFileSync(join(destination,row.path));assert.equal(bytes.length,1);assert.equal(existsSync(join(destination,row.path.replaceAll('\\','/'))),false);}
  assert.equal(receipt.status,0);assert.equal(receipt.closed,true);assert.deepEqual(receipt.survivors,[]);
  return{receipt,verified};
});
await check('literal backslash links stay contained; escaping targets and metadata fail',async()=>{
  const objects=join(work,'objects');execFileSync(git,['init','--bare','--quiet','--template=',objects]);
  const object=bytes=>execFileSync(git,['--git-dir',objects,'hash-object','-w','--stdin'],{input:bytes}).toString().trim();
  const bytes=Buffer.from('literal bytes\n'),link=Buffer.from('back\\slash');
  const entries=[{path:'back\\slash',mode:'100644',blob:object(bytes),bytes:bytes.length},{path:'link',mode:'120000',blob:object(link),bytes:link.length}];
  const destination=join(work,'literal-link');const receipt=await extractCommitted({git,repository:objects,candidate:PRODUCT,entries,destination,environment:{PATH:'/usr/bin:/bin'},bounds:boundsFor(entries)});
  await verifyArchive(destination,entries);assert.equal(readlinkSync(join(destination,'link')),'back\\slash');assert.deepEqual(readFileSync(join(destination,'link')),bytes);assert.deepEqual(readdirSync(destination).sort(),['back\\slash','link']);
  const targets=['../outside','/tmp/unified76-never-write','a/../../outside'];
  for(const[index,target]of targets.entries()){
    const content=Buffer.from(target),rows=[{path:'link',mode:'120000',blob:object(content),bytes:content.length}],output=join(work,'escape-'+index);
    await assert.rejects(extractCommitted({git,repository:objects,candidate:PRODUCT,entries:rows,destination:output,environment:{PATH:'/usr/bin:/bin'},bounds:boundsFor(rows)}));assert.equal(readdirSync(output).includes('link'),false);
  }
  const badMode=[{...entries[0],mode:'100600'}];assert.throws(()=>validateEntries(badMode,boundsFor(badMode)));
  const badHash=[{...entries[0],blob:'wrong'}];assert.throws(()=>validateEntries(badHash,boundsFor(badHash)));
  const wrongSize=[{...entries[0],bytes:entries[0].bytes+1}];await assert.rejects(extractCommitted({git,repository:objects,candidate:PRODUCT,entries:wrongSize,destination:join(work,'wrong-size'),environment:{PATH:'/usr/bin:/bin'},bounds:boundsFor(wrongSize)}));
  assert.equal(existsSync(join(work,'outside')),false);return{receipt,escapeTargetsRejected:3,modeHashSizeRefusals:3};
});
await check('unchanged actual duplicate-build and owned-outer-observer controls',async()=>{
  const result=spawnSync(node24,[join(owned,'../review-v4/controls.mjs')],{cwd:repository,env:{PATH:dirname(node24)+':/usr/bin:/bin',HOME:work,TMPDIR:work},encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
  writeFileSync(join(work,'v4.stdout'),result.stdout??'',{flag:'wx'});writeFileSync(join(work,'v4.stderr'),result.stderr??'',{flag:'wx'});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr+result.stdout);
  const summary=JSON.parse(result.stdout.trim());assert.deepEqual(summary.summary,{pass:4,fail:0});report.v4Replay=JSON.parse(readFileSync(join(summary.work,'REPORT.json')));
  return{status:result.status,summary,qualification:'Unchanged four-group author replay; no candidate production build or full gate'};
});
report.driverSha256=sha(JSON.stringify(verifyDriverSeal()));report.finishedAt=new Date().toISOString();
report.summary={pass:report.results.filter(row=>row.status==='PASS').length,fail:report.results.filter(row=>row.status==='FAIL').length};
writeFileSync(join(work,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({work,summary:report.summary,driverSha256:report.driverSha256,wholeGateLaunched:false}));if(report.summary.fail)process.exitCode=1;
