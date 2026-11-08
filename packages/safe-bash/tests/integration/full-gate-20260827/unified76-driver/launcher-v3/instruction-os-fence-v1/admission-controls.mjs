import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {directory,node24,save,sha} from '../common.mjs';
import {verifyDriverSeal} from '../admission.mjs';

const root=realpathSync(mkdtempSync('/private/tmp/unified76-os-admission-')),seal=verifyDriverSeal(),rows=[];
for(const mode of ['valid','missing-binding','changed-guard','changed-tool-binding','missing-receipt','platform','architecture','ambient-loader']){
  const copy=join(root,mode),marker=join(copy,'target-marker');mkdirSync(copy);
  for(const file of [...Object.keys(seal.files),'DRIVER.json']){assert.ok(!file.includes('/')&&!/^agents\.md$/iu.test(file));const bytes=readFileSync(join(directory,file));assert.ok(bytes.length<16*1024*1024);writeFileSync(join(copy,file),bytes,{flag:'wx'});}
  if(mode==='missing-binding'){const changed=structuredClone(seal);delete changed.files['os-instruction-fence.mjs'];writeFileSync(join(copy,'DRIVER.json'),JSON.stringify(changed));}
  if(mode==='changed-guard')writeFileSync(join(copy,'os-instruction-fence.mjs'),readFileSync(join(copy,'os-instruction-fence.mjs'),'utf8')+'\n');
  if(mode==='changed-tool-binding'){const file=join(copy,'OS-INSTRUCTION-FENCE.json'),changed=JSON.parse(readFileSync(file));changed.binary.sha256='0'.repeat(64);writeFileSync(file,JSON.stringify(changed));}
  const url=pathToFileURL(join(copy,'admission.mjs')).href,os=pathToFileURL(join(copy,'os-instruction-fence.mjs')).href,external=pathToFileURL(join(copy,'external-admission.mjs')).href;
  const action=mode==='missing-receipt'?`(await import(${JSON.stringify(url)})).requireRelease({},seal,{});`:mode==='platform'||mode==='architecture'?`Object.defineProperty(process,${JSON.stringify(mode==='platform'?'platform':'arch')},{value:${JSON.stringify(mode==='platform'?'linux':'x64')}});(await import(${JSON.stringify(os)})).verifyInstructionFenceExternal();`:mode==='ambient-loader'?`await(await import(${JSON.stringify(external)})).verifyExternal({DYLD_INSERT_LIBRARIES:'/unapproved'});`:'';
  const source=`import{writeFileSync}from'node:fs';try{const seal=(await import(${JSON.stringify(url)})).verifyDriverSeal();${action}writeFileSync(${JSON.stringify(marker)},'target reached');console.log('ADMITTED');}catch(error){console.error('REFUSED:'+error.message);process.exitCode=78;}`;
  const result=spawnSync(node24,['--input-type=module','-e',source],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  rows.push({mode,sourceSha256:sha(source),status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,targetReached:existsSync(marker)});
  if(mode==='valid'){assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'ADMITTED\n');assert.equal(existsSync(marker),true);}
  else{assert.equal(result.status,78,result.stderr);assert.equal(result.signal,null);assert.match(result.stderr,/^REFUSED:/u);assert.equal(existsSync(marker),false);const expected={
    'missing-binding':/driver closure may not omit/u,'changed-guard':/os-instruction-fence\.mjs/u,'changed-tool-binding':/OS-INSTRUCTION-FENCE\.json/u,
    'missing-receipt':/ROOT_RELEASE_UNIFIED76/u,platform:/OS instruction fence identity unavailable or changed/u,architecture:/OS instruction fence identity unavailable or changed/u,'ambient-loader':/DYLD_INSERT_LIBRARIES/u,
  };assert.match(result.stderr,expected[mode]);}
}
save(join(root,'REPORT.json'),{at:new Date().toISOString(),driverSha256:sha(JSON.stringify(seal)),rows,fullGate:false,qualification:'Copied sealed driver inputs only; no candidate/instruction snapshots. Platform controls alter the child diagnostic string, not the real OS. Refusal must precede the ordinary target marker.'});console.log(JSON.stringify({root,pass:rows.length}));
