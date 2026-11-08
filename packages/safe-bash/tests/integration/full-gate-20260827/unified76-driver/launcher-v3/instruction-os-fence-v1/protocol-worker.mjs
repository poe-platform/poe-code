import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openFencedWorker} from '../fenced-supervisor.mjs';
import {node24} from '../common.mjs';

const scope=openFencedWorker(),mode=process.argv[2],root=scope.envelope.roots[0].path,output=scope.envelope.roots[1].path;
if(mode==='observe'){
  await assert.rejects(scope.observer.register(Number(process.env.FOREIGN_PID)),/actual direct children/u);
  const child=spawn(node24,['--input-type=module','-e',"process.stdin.resume();process.stdin.once('end',()=>process.exitCode=0);"],{env:{},detached:true,stdio:['pipe','pipe','pipe']});
  const completion=new Promise(resolve=>child.once('close',(status,signal)=>resolve({status,signal})));
  const identity=await scope.observer.register(child.pid);assert.equal(identity.identity.pid,child.pid);assert.equal((await scope.observer.members(identity)).length,1);
  child.stdin.end();assert.deepEqual(await completion,{status:0,signal:null});assert.deepEqual(await scope.observer.members(identity),[]);
}else if(mode==='fd'){
  const expected=JSON.parse(process.env.SURROGATE_IDENTITY);let matched=false;
  for(let descriptor=3;descriptor<128;descriptor++){try{const actual=fstatSync(descriptor);if(actual.dev===expected.dev&&actual.ino===expected.ino)matched=true;}catch(error){assert.equal(error.code,'EBADF');}}
  assert.equal(matched,false,'unrelated writable regular-file FD must not survive launcher');
}else{
  const source="import assert from 'node:assert/strict';import{writeFileSync,existsSync}from'node:fs';assert.throws(()=>writeFileSync(process.argv[1],''),error=>['EPERM','EACCES'].includes(error.code));assert.equal(existsSync(process.argv[1]),false);console.log('restricted phase');";
  const options={cwd:root,env:{HOME:join(root,'home'),TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp')},timeoutMs:5000,maxOutputBytes:1024*1024,stdout:join(output,'probe.stdout'),stderr:join(output,'probe.stderr'),observeSockets:true};
  if(mode==='outside')options.cwd='/private/tmp';
  if(mode==='extra')options.ipc=true;
  if(mode==='environment')options.env.HOME='/private/tmp';
  if(mode==='abandon'){
    void scope.supervise(node24,['--input-type=module','-e','setInterval(()=>{},1000);'],options).catch(()=>{});
    setTimeout(()=>process.exit(0),500);
    await new Promise(()=>{});
  }
  const socketSource=mode==='loopback'?"import{createServer}from'node:net';const server=createServer();server.listen(0,'127.0.0.1',()=>setTimeout(()=>server.close(),3000));":"import{createServer}from'node:net';createServer().listen(0,'0.0.0.0');";
  const operation=scope.supervise(node24,['--input-type=module','-e',['loopback','network'].includes(mode)?socketSource:source,join(root,'AGENTS.md')],options);
  if(['outside','extra','environment'].includes(mode))await assert.rejects(operation);
  else if(mode==='network'){const result=await operation;assert.equal(result.clean,false);assert.match(result.observerError,/Non-loopback owned TCP listener/u);assert.ok(result.signals.length>0);assert.deepEqual(result.survivors,[]);}
  else{const result=await operation;assert.equal(result.status,0);assert.equal(result.clean,true);if(mode!=='loopback')assert.equal(readFileSync(options.stdout,'utf8'),'restricted phase\n');}
}
writeFileSync(join(root,'ordinary-marker'),mode);
await delay(1);
console.log(JSON.stringify({mode,passed:true,pid:process.pid}));
