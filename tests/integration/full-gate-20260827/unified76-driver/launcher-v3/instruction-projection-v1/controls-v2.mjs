import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,rmdirSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {readProjection,selectProjection,projectionReceipt,dependencyProjection,assertNoInstructionCopyTree,instructionName} from '../projection.mjs';
import {extractCommitted,transferHistory,validateEntries,cleanGitEnvironment,ARCHIVE_PATH_PROFILE} from '../transport.mjs';
import {verifyArchive,capture} from '../inventory.mjs';
import {repository,node24,directory,copyDependencies,verifyAssembly,sha} from '../common.mjs';
import {verifyDriverSeal,requireRelease} from '../admission.mjs';
import {readProfile} from '../profile.mjs';
import {BOUNDS,PRODUCT} from '../policy.mjs';

const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git',work=realpathSync(mkdtempSync(join(tmpdir(),'unified76-instruction-controls-')));
const environment=cleanGitEnvironment({PATH:dirname(node24)+':/usr/bin:/bin',HOME:work,TMPDIR:work});
const report={candidate:PRODUCT,work,createdAt:new Date().toISOString(),results:[],wholeGateLaunched:false,privateEngineExecuted:false};
const check=async(name,operation)=>{try{report.results.push({name,status:'PASS',detail:await operation()});}catch(error){report.results.push({name,status:'FAIL',error:error.stack});}};
const policy=readProjection(),profile=readProfile(),metadata=policy.candidateEntries.map(({sha256,...entry})=>entry);
const ordinary=profile.scopeInputs.find(entry=>entry.path==='package.json'),rows=[...metadata,ordinary];
const bounds=entries=>({...BOUNDS,archiveEntries:entries.length,archiveBytes:entries.reduce((sum,entry)=>sum+entry.bytes,0)});
const extract=(entries,destination,options={})=>extractCommitted({git,repository,candidate:PRODUCT,entries,destination,environment,bounds:bounds(entries),...options});
const scan=root=>{const found=[];const visit=(directory,prefix='')=>{for(const name of readdirSync(directory)){if(name==='.git')continue;const relative=prefix?prefix+'/'+name:name,path=join(directory,name);if(instructionName(relative))found.push(relative);if(lstatSync(path).isDirectory())visit(path,relative);}};visit(root);return found;};
let extracted,verified;
await check('exact original five body streams have no physical instruction files',async()=>{
  const destination=join(work,'projected');extracted=await extract(rows,destination);verified=await verifyArchive(destination,rows,extracted);
  assert.equal(verified.logical.count,6);assert.equal(verified.count,1);assert.equal(verified.metadataOnly.length,5);assert.deepEqual(scan(destination),[]);
  assert.deepEqual(readdirSync(destination),['package.json']);assert.equal(sha(readFileSync(join(destination,'package.json'))),profile.packageManifestSha256);
  assert.equal(extracted.bytes,rows.reduce((sum,entry)=>sum+entry.bytes,0));assert.equal(extracted.closed,true);assert.deepEqual(extracted.survivors,[]);
  return{transport:extracted,logical:verified.logical,physical:verified.count,instructionFiles:0};
});
await check('all presealed metadata fields and candidate binding fail closed',async()=>{
  let rejected=0;
  for(const field of ['path','mode','blob','bytes','sha256']){const changed=structuredClone(policy);changed.candidateEntries[0][field]=field==='bytes'?12423:'changed';assert.throws(()=>readProjection(changed),/metadata changed/);rejected++;}
  for(const field of ['origin','path','mode','bytes','sha256']){const changed=structuredClone(policy);changed.dependencyEntries[0][field]=field==='bytes'?9230:'changed';assert.throws(()=>readProjection(changed),/metadata changed/);rejected++;}
  assert.throws(()=>selectProjection(rows,'0'.repeat(40)),/candidate binding/);assert.throws(()=>selectProjection(rows.slice(1),PRODUCT),/all five/);rejected+=2;
  for(const field of ['mode','bytes','blob']){const changed=structuredClone(rows);changed[0][field]=field==='bytes'?1:field==='mode'?'100755':'0'.repeat(40);await assert.rejects(extract(changed,join(work,'never-metadata-'+field)),/binding/);assert.equal(existsSync(join(work,'never-metadata-'+field)),false);rejected++;}
  return{rejected};
});
await check('instruction path aliases and unsafe archive paths reject before writes',async()=>{
  let rejected=0;
  for(const alias of ['AGENTS.MD','copy.md','nested/AGENTS.md']){const changed=structuredClone(rows);changed[0].path=alias;await assert.rejects(extract(changed,join(work,'never-alias-'+rejected)),/unapproved instruction/);rejected++;}
  for(const path of ['./AGENTS.md','a/../AGENTS.md','../escape','/absolute','a//entry','bad\0name','.git/config']){const changed=[{...ordinary,path}];assert.throws(()=>validateEntries(changed,bounds(changed)));rejected++;}
  for(const foreign of [{...ARCHIVE_PATH_PROFILE,platform:'win32'},{...ARCHIVE_PATH_PROFILE,separator:'\\'}]){await assert.rejects(extract([ordinary],join(work,'never-foreign'),{pathProfile:foreign}),/pinned POSIX/);rejected++;}
  return{rejected};
});
await check('missing or tampered streamed logical proof never admits physical-only projection',async()=>{
  const destination=join(work,'projected');let rejected=0;
  await assert.rejects(verifyArchive(destination,rows));rejected++;
  for(const mutation of [value=>delete value.hashes['AGENTS.md'],value=>value.hashes['AGENTS.md']='0'.repeat(64),value=>value.projection.metadataOnly.pop(),value=>value.projection.logical.entries--,value=>value.projection.physical.bytes++,value=>value.closed=false,value=>value.survivors.push(99999)]){
    const changed=structuredClone(extracted);mutation(changed);await assert.rejects(verifyArchive(destination,rows,changed));rejected++;
  }
  return{rejected};
});
await check('missing added modified and mode-changed noninstruction inputs reject',async()=>{
  const destination=join(work,'projected'),file=join(destination,'package.json'),saved=readFileSync(file),outside=join(work,'saved-package');
  renameSync(file,outside);await assert.rejects(verifyArchive(destination,rows,extracted),/missing physical/);renameSync(outside,file);
  writeFileSync(join(destination,'unexpected.txt'),'unexpected',{flag:'wx'});await assert.rejects(verifyArchive(destination,rows,extracted),/physical/);rmSync(join(destination,'unexpected.txt'));
  writeFileSync(file,'x');await assert.rejects(verifyArchive(destination,rows,extracted));writeFileSync(file,saved);
  chmodSync(file,0o755);await assert.rejects(verifyArchive(destination,rows,extracted));chmodSync(file,0o644);
  await verifyArchive(destination,rows,extracted);return{rejected:4,restored:true};
});
await check('corrupt and truncated instruction streams reject without plaintext writes',async()=>{
  const stub=join(work,'bad-git.mjs');writeFileSync(stub,'#!'+node24+'\nimport{createInterface}from"node:readline";for await(const line of createInterface({input:process.stdin})){process.stdout.write(line+" blob 12424\\n");process.stdout.write(Buffer.alloc(12424,120));process.stdout.write("\\n");}\n',{mode:0o755,flag:'wx'});
  const target=join(work,'corrupt');await assert.rejects(extract(rows,target,{git:stub}),/Git content\/hash mismatch/);assert.equal(existsSync(target),false);
  const truncated=join(work,'short-git.mjs');writeFileSync(truncated,'#!'+node24+'\nprocess.stdout.write('+JSON.stringify(metadata[0].blob+' blob 12424\n')+');process.stdout.write("short");\n',{mode:0o755,flag:'wx'});
  const shortTarget=join(work,'truncated');await assert.rejects(extract(rows,shortTarget,{git:truncated}),/truncated Git blob stream/);assert.equal(existsSync(shortTarget),false);
  return{rejected:2,instructionFiles:0};
});
await check('opaque history preserves real object identities with no checkout',async()=>{
  const objects=join(work,'opaque-source'),target=join(work,'opaque-destination');execFileSync(git,['init','--bare','--quiet','--template=',objects],{env:environment});mkdirSync(target);execFileSync(git,['init','--quiet','--template=',target],{env:environment});
  for(const entry of [...new Map(metadata.map(entry=>[entry.blob,entry])).values()]){
    const producer=spawn(git,['cat-file','blob',entry.blob],{cwd:repository,env:environment,stdio:['ignore','pipe','inherit']});
    const consumer=spawn(git,['--git-dir',objects,'hash-object','-w','--stdin'],{env:environment,stdio:['pipe','pipe','inherit']});
    const ended=[producer,consumer].map(child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(status,signal)=>status===0&&signal===null?resolve():reject(Error('opaque transfer failed')));}));
    let identity='';consumer.stdout.on('data',chunk=>identity+=chunk);await pipeline(producer.stdout,consumer.stdin);await Promise.all(ended);assert.equal(identity.trim(),entry.blob);
  }
  const tree=execFileSync(git,['--git-dir',objects,'mktree'],{env:environment,input:`100644 blob ${metadata[0].blob}\tAGENTS.md\n`}).toString().trim();
  const commit=execFileSync(git,['--git-dir',objects,'commit-tree',tree],{env:{...environment,GIT_AUTHOR_NAME:'projection-control',GIT_AUTHOR_EMAIL:'control@invalid',GIT_COMMITTER_NAME:'projection-control',GIT_COMMITTER_EMAIL:'control@invalid'},input:'Opaque instruction provenance control\n'}).toString().trim();
  const receipt=await transferHistory({git,repository:objects,candidate:commit,destination:target,environment});
  assert.equal(receipt.checkoutPerformed,false);assert.equal(execFileSync(git,['--git-dir',join(target,'.git'),'rev-parse',commit+'^{tree}'],{env:environment}).toString().trim(),tree);
  execFileSync(git,['--git-dir',join(target,'.git'),'cat-file','-e',commit+':AGENTS.md'],{env:environment});
  assert.deepEqual(readdirSync(target),['.git']);assert.deepEqual(scan(target),[]);assert.deepEqual(scan(objects),[]);
  return{receipt,commit,tree,originalBlob:metadata[0].blob,actualCandidateAssembly:verifyAssembly(),qualification:'Actual bounded Git mechanism proof plus unchanged exact f5 assembly; not a second full f5 history transfer'};
});
await check('symlink-to-instruction aliases reject while contained links remain usable',async()=>{
  const objects=join(work,'links');execFileSync(git,['init','--bare','--quiet','--template=',objects],{env:environment});
  let rejected=0;for(const target of ['AGENTS.md','nested/AGENTS.md','../outside','/absolute']){
    const content=Buffer.from(target),blob=execFileSync(git,['--git-dir',objects,'hash-object','-w','--stdin'],{env:environment,input:content}).toString().trim();
    const entries=[{path:'link',mode:'120000',blob,bytes:content.length}],destination=join(work,'link-'+rejected);
    await assert.rejects(extract(entries,destination,{repository:objects}));assert.equal(existsSync(join(destination,'link')),false);rejected++;
  }
  return{rejected};
});
await check('benchmark dependency projection is exact and reconciled',async()=>{
  const origin=policy.dependencyEntries[0].origin,destination=join(work,'benchmark-dependencies');
  const receipt=copyDependencies(destination,origin);assert.equal(receipt.metadataOnly.length,1);assert.equal(receipt.logical.files-receipt.physical.files,1);assert.equal(receipt.logical.bytes-receipt.physical.bytes,9231);
  assert.deepEqual(scan(destination),[]);assert.equal(existsSync(join(destination,'just-bash/dist/AGENTS.md')),false);
  const imported=spawnSync(node24,['--input-type=module','-e',`const m=await import(${JSON.stringify(join(destination,'just-bash/dist/index.js'))});if(typeof m.Bash!=='function')throw Error('missing baseline API');`],{env:environment,encoding:'utf8',timeout:10000});
  assert.equal(imported.status,0,imported.stderr);return{receipt,baselineImportStatus:imported.status,instructionFiles:0};
});
await check('dependency missing-body origin alias and identity negatives reject',async()=>{
  const entry=policy.dependencyEntries[0],valid={path:entry.path,mode:0o644,bytes:entry.bytes,sha256:entry.sha256};let rejected=0;
  for(const change of [{path:'other.md'},{mode:0o755},{bytes:1},{sha256:'0'.repeat(64)}]){assert.throws(()=>dependencyProjection([{...valid,...change}],entry.origin));rejected++;}
  assert.throws(()=>dependencyProjection([],entry.origin),/missing/);assert.throws(()=>dependencyProjection([valid],work),/origin/);rejected+=2;
  assert.throws(()=>dependencyProjection([{path:'new/AGENTS.md',mode:0o644,bytes:0,sha256:sha('')}],work),/unapproved/);rejected++;
  return{rejected};
});
await check('unapproved copy-tree instructions refuse before any copy',async()=>{
  const input=join(work,'copy-preflight');mkdirSync(input);writeFileSync(join(input,'ordinary.txt'),'ordinary',{flag:'wx'});
  assert.equal(assertNoInstructionCopyTree(input).files,1);
  mkdirSync(join(input,'AGENTS.md'));assert.throws(()=>assertNoInstructionCopyTree(input),/unapproved instruction/);rmdirSync(join(input,'AGENTS.md'));
  assert.equal(assertNoInstructionCopyTree(input).files,1);return{ordinary:1,instructionNamedDirectoryRejected:true,privateCheckoutAccessed:false};
});
await check('old release cannot authorize successor; imports remain inert',async()=>{
  const seal=verifyDriverSeal();assert.throws(()=>requireRelease({action:'ROOT_RELEASE_UNIFIED76',candidate:PRODUCT,driverSha256:'3d8d2a15214f12c07b64e3223f5e0088989845b8f60a74abb0a521dba32fa018'},seal,profile));
  const result=spawnSync(node24,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../run.mjs',import.meta.url).href)});await import(${JSON.stringify(new URL('../review-build-types.mjs',import.meta.url).href)});console.log('inert');`],{env:environment,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'inert\n');return{oldReleaseRejected:true,importsInert:true,driverSha256:sha(JSON.stringify(seal))};
});
await check('unchanged POSIX observer and actual duplicate-build control families',async()=>{
  const result=spawnSync(node24,[join(directory,'review-v5/controls.mjs')],{cwd:repository,env:environment,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  writeFileSync(join(work,'old-controls.stdout'),result.stdout??'',{flag:'wx'});writeFileSync(join(work,'old-controls.stderr'),result.stderr??'',{flag:'wx'});
  assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(result.signal,null);const receipt=JSON.parse(result.stdout.trim());assert.deepEqual(receipt.summary,{pass:5,fail:0});
  report.oldControls=JSON.parse(readFileSync(join(receipt.work,'REPORT.json')));return{summary:receipt,qualification:'Five unchanged V5 groups including four unchanged V4 groups; controls, not a candidate full production build'};
});
report.finishedAt=new Date().toISOString();report.driverSha256=sha(JSON.stringify(verifyDriverSeal()));report.summary={pass:report.results.filter(row=>row.status==='PASS').length,fail:report.results.filter(row=>row.status==='FAIL').length};
await check('final instruction absence before evidence settlement',async()=>{report.instructionPlaintextFiles=scan(work);assert.deepEqual(report.instructionPlaintextFiles,[]);return{instructionEntries:0};});
report.summary={pass:report.results.filter(row=>row.status==='PASS').length,fail:report.results.filter(row=>row.status==='FAIL').length};
writeFileSync(join(work,'REPORT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({work,summary:report.summary,wholeGateLaunched:false,driverSha256:report.driverSha256}));if(report.summary.fail)process.exitCode=1;
