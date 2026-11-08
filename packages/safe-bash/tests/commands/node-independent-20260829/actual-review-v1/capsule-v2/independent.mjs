import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {runRawControl,ids as rawIds} from './raw-controls.mjs';

export const independentIds=[...rawIds,...Array.from({length:10},(_,index)=>'E'+String(index+1).padStart(2,'0'))];
export async function runIndependent({moduleRoot,adapter},publish){
 const load=name=>import(pathToFileURL(moduleRoot+'/'+name).href);
 const node=await load('commands/node/index.js');
 const {fsDescriptor}=await load('commands/node/host.js');
 const {publishNodeObservation}=await load('commands/node/diagnostics.js');
 const {FsError}=await load('contracts/errors.js');
 const {MemoryFileSystem}=await load('fs/memory/index.js');
 const {Shell}=await load('shell/shell.js');
 const {agentCommands}=await load('plugins/index.js');
 const api={...node,fsDescriptor,publishNodeObservation,FsError};
 const encode=text=>new TextEncoder().encode(text);
 const decode=bytes=>new TextDecoder('utf8',{ignoreBOM:true}).decode(bytes);
 const rows=[];let workerTotal=0;let entryTotal=0;
 function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
 async function actual(args,options={}){
  const fs=options.fs??new MemoryFileSystem();const events=[];const registered=[];const output={stdout:[],stderr:[]};let retirement;let clean=false;let result;let raw=false;let reason;
  const controller=options.controller??new AbortController();
  const reference=node.createNodeWorkerProvider({entry:pathToFileURL(adapter).href,identity:'author-public-bb23-node-adapter-v1',observe:event=>{assert(events.length<2048);events.push(event);return options.observe?.(event);}});
  const provider={profile:reference.profile,identity:reference.identity,prepare(request,services){const session=reference.prepare(request,services);return{start:session.start,cancel:session.cancel,async retire(){retirement=await session.retire();return retirement;}};}};
  const command=node.createNodeCommand({provider,grants:{stdoutWrite:true,stderrWrite:true,...options.grants}});
  const sink=name=>({async write(bytes){assert(output[name].reduce((sum,item)=>sum+item.length,0)+bytes.length<=1048576);output[name].push(Uint8Array.from(bytes));}});
  const context={command:'node',args,fs,cwd:options.cwd??'/',env:options.env??{},signal:controller.signal,stdin:options.stdin??{async *[Symbol.asyncIterator](){}},stdout:sink('stdout'),stderr:sink('stderr'),registerCleanup:callback=>registered.push(callback)};
  try{result=await command.execute(context);}catch(error){raw=true;reason=error;}
  finally{const outcomes=await Promise.allSettled(registered.map(callback=>callback()));const count=kind=>events.filter(event=>event.kind===kind).length;workerTotal+=count('workerCreated');entryTotal+=count('guestEntry');clean=outcomes.every(outcome=>outcome.status==='fulfilled')&&(count('workerCreated')===0&&(!retirement||retirement.acquisition==='none')||count('workerCreated')===1&&count('workerExit')===1&&count('retired')===1&&retirement?.acquisition==='exited');assert(clean,'actual Worker/parent cleanup');}
  return{result,raw,reason,fs,events,stdout:decode(Buffer.concat(output.stdout)),stderr:decode(Buffer.concat(output.stderr)),retirement,clean};
 }
 async function shellRun(script,options={}){
  const fs=options.fs??new MemoryFileSystem();const events=[];const retirements=[];
  const reference=node.createNodeWorkerProvider({entry:pathToFileURL(adapter).href,identity:'author-public-bb23-node-adapter-v1',observe:event=>{assert(events.length<4096);events.push(event);}});
  const provider={profile:reference.profile,identity:reference.identity,prepare(request,services){const session=reference.prepare(request,services);return{start:session.start,cancel:session.cancel,async retire(){const outcome=await session.retire();retirements.push(outcome);return outcome;}};}};
  const shell=new Shell({fs,cwd:'/',limits:options.limits,env:{MARK:'parent'}});shell.use(agentCommands());shell.register(node.createNodeCommand({provider,grants:{stdoutWrite:true,stderrWrite:true,dataRead:true,dataWrite:true}}));options.configure?.(shell);
  let result,raw=false,reason;
  try{result=await shell.exec(script);}catch(error){raw=true;reason=error;}
  finally{await shell.dispose();const count=kind=>events.filter(event=>event.kind===kind).length;workerTotal+=count('workerCreated');entryTotal+=count('guestEntry');assert.equal(count('workerCreated'),count('workerExit'));assert.equal(count('workerCreated'),retirements.filter(item=>item.acquisition==='exited').length);}
  return{result,raw,reason,events,fs};
 }
 function status(outcome,code,stdout){assert.equal(outcome.raw,false);assert.equal(outcome.result.exitCode,code);if(stdout!==undefined)assert.equal(outcome.stdout,stdout);}
 for(const id of independentIds){
  const beforeWorkers=workerTotal,beforeEntries=entryTotal;let failure;let clean=true;
  try{
   if(rawIds.includes(id)){
    const active=new Set();let rescue=false;const cleanup=[];
    const owner={assertActive(){},enrollRescue(callback){const token={};active.add(token);const timer=setTimeout(()=>{rescue=true;callback();},1500);return{close(){clearTimeout(timer);active.delete(token);}};},recordCleanupRejection(reason){cleanup.push({present:true,value:reason});},assertRetired(){assert.equal(active.size,0);assert.equal(rescue,false);}};
    await runRawControl(id,api,owner);
   }else if(id==='E01'){
    const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.writeFile('/work/in.json',encode('{"count":2}'));await fs.writeFile('/work/main.cjs',encode("const fs=require('fs');const v=JSON.parse(fs.readFileSync('in.json','utf8'));v.count+=1;fs.writeFileSync('out.json',JSON.stringify(v));console.log(v.count);"));const result=await actual(['/work/main.cjs'],{fs,cwd:'/work',grants:{sourceRead:true,dataRead:true,dataWrite:true}});status(result,0,'3\n');assert.equal(decode(await fs.readFile('/work/out.json')),'{"count":3}');assert.equal(decode(await fs.readFile('/work/in.json')),'{"count":2}');
   }else if(id==='E02'){
    for(const [expression,expected]of[['undefined','undefined\n'],['null','null\n'],['false','false\n'],['-0','0\n'],['"é😀"','é😀\n']])status(await actual(['-p',expression]),0,expected);
   }else if(id==='E03'){
    const fs=new MemoryFileSystem();const result=await actual(['-e',"require('fs').writeFileSync('/bad','x'); const broken = ;"],{fs,grants:{dataWrite:true}});status(result,2,'');assert.equal(result.events.length,0);await assert.rejects(fs.stat('/bad'),{code:'ENOENT'});
   }else if(id==='E04'){
    const fs=new MemoryFileSystem();const bytes=Uint8Array.from([239,187,191,195,169,0,240,159,152,128,255,226,130]);await fs.writeFile('/bytes',bytes);const result=await actual(['-e',"console.log(require('fs').readFileSync('/bytes','utf8'));"],{fs,grants:{dataRead:true}});status(result,0,decode(bytes)+'\n');assert.deepEqual(Array.from(await fs.readFile('/bytes')),Array.from(bytes));
   }else if(id==='E05'){
    const fs=new MemoryFileSystem();await fs.writeFile('/keys.json',encode('{"__proto__":"p","constructor":"c","toString":"s"}'));const result=await actual(['-e',"const v=require('./keys.json');const a='__'+'proto__';const b='con'+'structor';console.log(v[a],v[b],v.toString);"],{fs,grants:{dataRead:true,jsonModules:true}});status(result,0,'p c s\n');
   }else if(id==='E06'){
    const fs=new MemoryFileSystem();await fs.writeFile('/cache.json',encode('{"n":1}'));const original=fs.realpath.bind(fs);let checks=0;fs.realpath=async(...args)=>{if(++checks===2)throw new FsError('EACCES',{path:'/cache.json'});return original(...args);};const result=await actual(['-e',"console.log(require('./cache.json').n);try{require('./cache.json');}catch(error){console.log(error.code);}"],{fs,grants:{dataRead:true,jsonModules:true}});status(result,0,'1\nEACCES\n');assert.equal(checks,2);
   }else if(id==='E07'){
    const fs=new MemoryFileSystem();await fs.writeFile('/main.cjs',encode("try{require('fs').readFileSync('/data','utf8');}catch(error){console.log(error.code);}"));await fs.writeFile('/data',encode('secret'));const original=fs.readFile.bind(fs);let dataReads=0;fs.readFile=async(path,...rest)=>{if(path==='/data')dataReads++;return original(path,...rest);};status(await actual(['/main.cjs'],{fs,grants:{sourceRead:true}}),0,'ERR_VNODE_DENIED\n');assert.equal(dataReads,0);
   }else if(id==='E08'){
    const result=await shellRun("node -p '123'",{limits:{maxOutputBytes:2}});assert(result.raw||result.result.exitCode!==0,'shared output bound bypassed');const commands=await shellRun("node -e ''; node -e ''; node -e ''",{limits:{maxCommands:2}});assert(commands.raw||commands.result.exitCode!==0,'shared command bound reset');assert(commands.events.filter(event=>event.kind==='guestEntry').length<=2);
   }else if(id==='E09'){
    const fs=new MemoryFileSystem();const gate=deferred();let entered=false,closed=false;const original=fs.readFile.bind(fs);fs.readFile=async(path,options)=>{if(path!=='/held')return original(path,options);entered=true;gate.resolve();return new Promise((resolve,reject)=>{const abort=()=>{closed=true;options.signal.removeEventListener('abort',abort);reject(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();});};
    const result=await shellRun('driver',{fs,configure:shell=>shell.register({name:'driver',async execute(parent){const local=new AbortController();const pending=parent.invoke('node',['-e',"require('fs').readFileSync('/held','utf8');"],{signal:local.signal});void pending.then(gate.resolve,gate.resolve);try{await gate.promise;assert(entered);const sibling=await parent.invoke('node',['-p','7']);local.abort(false);try{await pending;}catch(reason){assert.equal(reason,false);}assert.equal(sibling.exitCode,0);assert.equal(parent.signal.aborted,false);assert.equal(parent.env.MARK,'parent');return{exitCode:0};}finally{local.abort(false);try{await pending;}catch{}}}})});assert.equal(result.raw,false);assert.equal(result.result.exitCode,0);assert.equal(result.result.stdout,'7\n');assert(closed);
   }else if(id==='E10'){
    const result=await shellRun('node -e \'console.log("first");console.log("second");\' | head -n 1');assert.equal(result.raw,false);assert.equal(result.result.exitCode,0);assert.equal(result.result.stdout,'first\n');
   }
  }catch(error){failure={message:typeof error?.message==='string'?error.message.slice(0,2048):'non-Error assertion'};if(/cleanup|retire|rescue/i.test(failure.message))clean=false;}
  const row={id,pass:!failure,clean,role:id.startsWith('R')?'raw-parent-synthetic':'actual-engine-or-preflight',workers:workerTotal-beforeWorkers,guestEntries:entryTotal-beforeEntries,failure:failure??null};rows.push(row);await publish(row);if(!clean)throw Error('independent unsafe ownership result');
 }
 return rows;
}
