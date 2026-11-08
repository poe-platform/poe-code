import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const directory = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2];
if (!['--data-only','--actual'].includes(mode) || process.argv.length !== 7 || process.argv[3] !== '--seal' || process.argv[4] !== directory + '/PREEXECUTION-SEAL.json' || process.argv[5] !== '--sha256') throw Error('EXACT_CONTROLS_ARGUMENTS');
const sealBytes = fs.readFileSync(process.argv[4]);
if (hash(sealBytes) !== process.argv[6]) throw Error('PRESEAL_DRIFT');
const seal = JSON.parse(sealBytes);
for (const row of seal.files) {
  const filename = path.join(directory,row.path), stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.bytes || hash(fs.readFileSync(filename)) !== row.sha256) throw Error('SOURCE_DRIFT:' + row.path);
}
const tools = JSON.parse(fs.readFileSync(directory + '/TOOLS.json')), control = JSON.parse(fs.readFileSync(directory + '/CONTROLS.json'));
if (process.execPath !== tools.tools.find(row => row.role === 'node').path || process.versions.node !== '22.22.2') throw Error('NODE_IDENTITY');
const { requestFor, admitRequest, renderProfile, retirement, reasonData, singleflight, canonical } = await import('./profile.mjs');
const { createAuthorProvider } = await import('./provider.mjs');
const results = [];
async function check(id, action) { try { await action(); results.push({ id, pass: true, role: 'DATA_ONLY' }); } catch(error) { results.push({ id, pass: false, role: 'DATA_ONLY', error: String(error) }); } }
const clone = value => JSON.parse(JSON.stringify(value));
const request = requestFor(control.cases[0],control,tools);
const base = { exit:true,close:true,stdoutEOF:true,stderrEOF:true,eventsEOF:true,groupPresent:false,captureFailure:false,unknownDescendants:false,children:[] };
await check('changed-case',()=>assert.throws(()=>admitRequest({...request,id:'UNKNOWN'},control,tools)));
await check('changed-argv',()=>assert.throws(()=>admitRequest({...request,argv:[...request.argv,'extra']},control,tools)));
await check('changed-env',()=>assert.throws(()=>admitRequest({...request,environment:{...request.environment,BASH_ENV:'x'}},control,tools)));
await check('unexpected-exec',()=>assert.throws(()=>admitRequest({...request,executable:'/bin/bash'},control,tools)));
await check('injected-profile-string',()=>assert.throws(()=>renderProfile({...request,filesystemRoot:'/tmp/"escape'},control,tools)));
await check('path-traversal',()=>assert.throws(()=>admitRequest({...request,cwd:request.cwd+'/../..'},control,tools)));
await check('readonly-capture',()=>{const profile=renderProfile(request,control,tools);assert.ok(profile.includes('(allow file-write* (subpath '+JSON.stringify(request.filesystemRoot)+'))'));assert.ok(!profile.includes('(allow file-write* (subpath '+JSON.stringify(control.root+'/capture')));});
for(const [id,key] of [['missing-exit','exit'],['missing-stdout-eof','stdoutEOF'],['missing-stderr-eof','stderrEOF'],['missing-close','close']]) await check(id,()=>assert.equal(retirement({...base,[key]:false}),'UNKNOWN'));
await check('unknown-descendant',()=>assert.equal(retirement({...base,unknownDescendants:true}),'UNKNOWN'));
await check('group-still-present',()=>assert.equal(retirement({...base,groupPresent:true}),'UNKNOWN'));
await check('duplicate-child-identity',()=>assert.equal(retirement({...base,children:[{pid:12,exit:true,close:true},{pid:12,exit:true,close:true}]}),'UNKNOWN'));
for(const [id,value]of[['zero-reason',0],['false-reason',false],['empty-reason','']])await check(id,()=>assert.equal(reasonData(value).value,value));
await check('cleanup-singleflight',async()=>{let count=0;const cleanup=singleflight(async()=>{count++;});const first=cleanup();assert.equal(first,cleanup());await first;assert.equal(count,1);});
await check('cleanup-failure-identity',async()=>{const reason=Error('owned-cleanup');const cleanup=singleflight(async()=>{throw reason;});await assert.rejects(cleanup(),error=>error===reason);await assert.rejects(cleanup(),error=>error===reason);});
await check('network-default-deny-source',()=>{const profile=renderProfile(request,control,tools);assert.ok(profile.includes('(deny network*)'));assert.ok(!profile.includes('(allow network'));});
assert.deepEqual(results.map(row=>row.id),control.dataControls);
if(results.some(row=>!row.pass)){console.log(JSON.stringify({mode,results}));process.exitCode=1;}
else if(mode==='--data-only'){console.log(JSON.stringify({mode,results,native:0,product:0,workers:0,fixtureTargets:0}));}
else {
  process.umask(0o22);
  if(Date.now()>=seal.preparationDeadline-160000)throw Error('INSUFFICIENT_PREPARATION_WINDOW');
  for(const tool of tools.tools){const stat=fs.lstatSync(tool.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==tool.bytes||(stat.mode&0o7777)!==tool.mode)throw Error('TOOL_METADATA_DRIFT');const digest=createHash('sha256');for await(const chunk of fs.createReadStream(tool.path,{highWaterMark:65536}))digest.update(chunk);if(digest.digest('hex')!==tool.sha256)throw Error('TOOL_HASH_DRIFT');}
  for(const row of tools.dependencyFiles){const stat=fs.lstatSync(row.path);if(!stat.isFile()||stat.size!==row.bytes||stat.mtimeMs!==row.mtimeMs||(stat.mode&0o7777)!==row.mode)throw Error('DEPENDENCY_METADATA_DRIFT');}
  const root=control.root;fs.mkdirSync(root,{mode:0o700});
  const outer=fs.openSync(root+'/OWNER.jsonl','wx',0o600);
  const publish=row=>fs.writeSync(outer,JSON.stringify({at:Date.now(),...row})+'\n');
  let provider, failure;const observations=[];
  try{
    publish({event:'OWNER_CREATED',preseal:hash(sealBytes),role:'HARmless_NODE_FIXTURES_NOT_NATIVE_OR_PRODUCT'});
    for(const name of ['stage','cases','profiles','capture','canary'])fs.mkdirSync(root+'/'+name,{mode:0o700});
    fs.writeFileSync(root+'/stage/fixture.mjs',fs.readFileSync(directory+'/fixture.mjs'),{flag:'wx',mode:0o400});
    fs.writeFileSync(root+'/canary/read','OWNED_READ_CANARY\n',{flag:'wx',mode:0o600});fs.writeFileSync(root+'/canary/write','OWNED_WRITE_CANARY\n',{flag:'wx',mode:0o600});
    provider=createAuthorProvider({root,authorOnly:true,deadline:seal.preparationDeadline,profiles:seal.profiles});
    for(const row of control.cases){
      const caseRoot=root+'/cases/'+row.id;fs.mkdirSync(caseRoot,{mode:0o700});for(const name of ['work','home','tmp','empty-path'])fs.mkdirSync(caseRoot+'/'+name,{mode:0o700});
      fs.writeFileSync(caseRoot+'/work/input','OWNED_INPUT\n',{flag:'wx',mode:0o600});fs.symlinkSync(root+'/canary/read',caseRoot+'/work/escape');
      const req=requestFor(row,control,tools);assert.equal(hash(canonical(req)),seal.requests.find(item=>item.id===row.id).sha256);
      const controller=new AbortController();let timer,reason,seenCancel=false,receipt,rejection,rejected=false;
      const cancelModes=['term','kill','descendant-term','abort-zero','abort-false','abort-empty','abort-default'];
      const event=event=>{const trigger=row.mode==='descendant-term'?'CHILD_READY':'ROOT_READY';if(cancelModes.includes(row.mode)&&event.event===trigger&&!timer)timer=setTimeout(()=>{seenCancel=true;if(row.mode==='abort-zero')controller.abort(0);else if(row.mode==='abort-false')controller.abort(false);else if(row.mode==='abort-empty')controller.abort('');else if(row.mode==='abort-default')controller.abort();else controller.abort('fixed-control-cancel');reason=controller.signal.reason;},100);};
      try{receipt=await provider.run(req,controller.signal,event);}catch(error){rejected=true;rejection=error;receipt=provider.receipts.at(-1);}finally{clearTimeout(timer);}
      if(provider.budget.halted||!receipt||receipt.retirement!=='DIRECT_AND_REPORTED_CHILDREN_RETIRED')throw rejection??Error('RETIREMENT_STOP');
      let pass=true,assertion;
      try{
        assert.equal(receipt.captureDescriptorsClosed,true);assert.equal(receipt.pid>0,true);assert.equal(receipt.groupPresent,false);
        if(cancelModes.includes(row.mode)){assert.equal(seenCancel,true);assert.equal(rejected,true);assert.equal(rejection,reason);}else assert.equal(rejected,false);
        const stdout=Buffer.from(receipt.stdoutBase64,'base64'),stderr=Buffer.from(receipt.stderrBase64,'base64');
        if(row.mode==='owned'){assert.deepEqual(stdout,Buffer.from([65,0,66,10]));assert.equal(stderr.toString(),'stderr\n');assert.equal(fs.readFileSync(caseRoot+'/work/out','utf8'),'OWNED_INPUT\n');}
        else if(row.mode==='error'){assert.equal(receipt.status,7);assert.equal(stderr.toString(),'fixture-error\n');}
        else if(['outside-read','outside-write','symlink-read'].includes(row.mode)){assert.equal(stdout.toString(),'denied\n');assert.ok(receipt.events.some(event=>event.event==='DENIED'&&['EPERM','EACCES'].includes(event.code)));}
        else if(row.mode==='exec-denied'){assert.ok(receipt.events.some(event=>event.event==='EXEC_DENIED'&&['EPERM','EACCES'].includes(event.code)));assert.ok(receipt.events.some(event=>event.event==='DENIED_ATTEMPT_CLOSE'));}
        else if(row.mode==='kill'){assert.equal(receipt.signal,'SIGKILL');assert.deepEqual(receipt.escalation.map(item=>item.name),['SIGTERM','SIGKILL']);}
        else if(row.mode==='descendant'){assert.equal(stdout.toString(),'child\n');assert.equal(receipt.children.length,1);}
        else if(row.mode==='descendant-term'){assert.equal(stdout.toString(),'child-term\n');assert.equal(receipt.children.length,1);}
        else if(row.mode==='drain'){assert.deepEqual(stdout,Buffer.alloc(65536,65));assert.deepEqual(stderr,Buffer.alloc(65536,66));}
        else if(row.mode==='stdin')assert.deepEqual(stdout,Buffer.from([65,0,66,255,10]));
        else assert.equal(stdout.toString(),'term\n');
        if(!['error','kill'].includes(row.mode))assert.equal(receipt.status,0);
        assert.equal(fs.readFileSync(root+'/canary/read','utf8'),'OWNED_READ_CANARY\n');assert.equal(fs.readFileSync(root+'/canary/write','utf8'),'OWNED_WRITE_CANARY\n');
      }catch(error){pass=false;assertion=String(error);}
      observations.push({id:row.id,pass,assertion,receipt});publish({event:'FIXTURE_RESULT',id:row.id,pass,assertion});
      fs.writeFileSync(root+'/'+row.id+'.json',JSON.stringify(observations.at(-1),null,2)+'\n',{flag:'wx'});
      if(!receipt.events.some(event=>event.event==='ROOT_READY'))throw Error('PLATFORM_STARTUP_HOLD_NO_FENCE_QUALIFICATION');
    }
  }catch(error){failure=String(error);publish({event:'STOP_OR_HOLD',error:failure});}
  finally{if(provider){const closed=await provider.close();publish({event:'PROVIDER_CLOSE',closed});if(closed.active||closed.retirement==='STOP')failure??='CLEANUP_STOP';}fs.closeSync(outer);}
  const result={mode,data:results,observations,failure,native:0,product:0,workers:0,network:'SOURCE_ONLY_NO_CONNECT_OR_LISTENER',unrun:control.cases.filter(row=>!observations.some(item=>item.id===row.id)).map(row=>row.id),budget:provider?.budget};
  fs.writeFileSync(root+'/RESULTS.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({mode,completed:observations.length,pass:observations.filter(row=>row.pass).length,fail:observations.filter(row=>!row.pass).length,failure,unrun:result.unrun,budget:result.budget}));if(failure||observations.some(row=>!row.pass))process.exitCode=1;
}
