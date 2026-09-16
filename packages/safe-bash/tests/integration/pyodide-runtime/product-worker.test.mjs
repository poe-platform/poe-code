import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'node:worker_threads';
import { PythonFileSystem, PythonStatTranslator, MemoryFileSystem } from 'poe-code/safe-fs/core';

test('product worker ordinary Python reaches delayed canonical storage and temporary files', async () => {
 const fs = new MemoryFileSystem();
 await fs.mkdir('/work'); await fs.mkdir('/tmp');
 const service = new PythonFileSystem(fs, {cwd:'/work'});
 const metadata = new PythonStatTranslator();
 const shared = new SharedArrayBuffer(500000);
 const control = new Int32Array(shared,0,2), bytes = new Uint8Array(shared,8);
 const worker = new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{
 const {register}=await import('tsx/esm/api');
 register();
 const {runPythonWorker}=await import(workerData.runner);
 const {loadPyodide}=await import(workerData.loader);
 await runPythonWorker({loadRuntime:configuration=>loadPyodide({...configuration,indexURL:new URL('.',workerData.loader).pathname}),start:workerData.start,postMessage:m=>parentPort.postMessage(m)});
 })().catch(e=>parentPort.postMessage({type:'error',message:String(e)}));`, {eval:true, execArgv:[], workerData:{
 runner:new URL('../../../src/commands/python/worker.ts',import.meta.url).href,
 loader:new URL('./node_modules/pyodide/pyodide.mjs',import.meta.url).href,
 start:{shared,invocation:{args:['-c', "from pathlib import Path; import tempfile; Path('a').write_text('hello'); print(Path('a').read_text()); f=tempfile.TemporaryFile(); f.write(b'abc'); f.seek(0); print(f.read()); f.close()"],cwd:'/work',env:{}},runtimeMount:'/.pyodide-runtime',maxTransferBytes:65536}
 }});
 const output=[];
 try {
 const outcome = await new Promise((resolve,reject)=>{
 worker.on('error',reject);
 worker.on('message',async m=>{
  if(m.type==='ready')return;
  if(m.type){resolve(m);return;}
  let value,status=1;
  try {
   if(m.op==='stdout'||m.op==='stderr'){output.push(new TextDecoder().decode(Uint8Array.from(m.args[0])));value=m.args[0].length;}
   else if(m.op==='stdin')value=[];
   else { await new Promise(resolve=>setTimeout(resolve,1)); value=await service.dispatch(m); if(['stat','lstat','fstat'].includes(m.op)) value=metadata.translate(value); }
   if(value instanceof Uint8Array)value=Array.from(value);
  }catch(e){value={code:e.code??'EIO'};status=2;}
  const data=new TextEncoder().encode(JSON.stringify(value??null));bytes.set(data);Atomics.store(control,1,data.length);Atomics.store(control,0,status);Atomics.notify(control,0);
 });
 });
 assert.deepEqual(outcome,{type:'exit',exitCode:0}, output.join(''));
 assert.equal(new TextDecoder().decode(await fs.readFile('/work/a')),'hello');
 assert.equal(output.join(''),"hello\nb'abc'\n");
 } finally {await worker.terminate();await service.close();}
});

import { Shell, agentCommands } from '../../../src/core.ts';
import { createPythonCommands, pythonCommands } from '../../../src/commands/python/index.ts';

function createWorker({onInitialization} = {}) {
 const worker = new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 parentPort.once('message',async start=>{
 try {
 const {register}=await import('tsx/esm/api');register();
 const {runPythonWorker}=await import(workerData.runner);
 const {loadPyodide}=await import(workerData.loader);
 await runPythonWorker({loadRuntime:configuration=>{const loading=loadPyodide({...configuration,indexURL:new URL('.',workerData.loader).pathname});parentPort.postMessage({type:"qualification-initializing"});return loading;},start,postMessage:m=>parentPort.postMessage(m)});
 }catch(e){parentPort.postMessage({type:'error',message:String(e)});}
 });`, {eval:true,execArgv:[],workerData:{runner:new URL('../../../src/commands/python/worker.ts',import.meta.url).href,loader:new URL('./node_modules/pyodide/pyodide.mjs',import.meta.url).href}});
 return { postMessage:value=>worker.postMessage(value), subscribe(listener,error){const receive=value=>{if(value.type==='qualification-initializing'){onInitialization?.();return;}listener(value);};worker.on('message',receive);worker.on('error',error);return()=>{worker.off('message',receive);worker.off('error',error);};},terminate:async()=>{await worker.terminate();} };
}

test('Shell Python file, alias, module, source pipe and canonical retained descriptors',async(t)=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');await fs.mkdir('/tmp');await fs.mkdir('/lib');
 await fs.writeFile('/lib/user.txt',new TextEncoder().encode('canonical lib'));
 await fs.writeFile('/work/helper.py',new TextEncoder().encode('answer = 42\n'));
 await fs.writeFile('/work/document café.py',new TextEncoder().encode(`
import os, sys, tempfile, errno
from pathlib import Path
assert sys.argv[1:] == ['two words']
assert not os.path.samefile('/', '/.pyodide-runtime')
assert Path('/lib/user.txt').read_text() == 'canonical lib'
os.symlink('/lib/user.txt', 'absolute-link')
assert Path('absolute-link').read_text() == 'canonical lib'
f = open('retained', 'w+b')
f.write(bytes(range(256)) * 300)
f.seek(65530)
assert f.read(20) == (bytes(range(256))*300)[65530:65550]
os.rename('retained', 'renamed')
os.unlink('renamed')
f.seek(0); f.write(b'XYZ'); f.truncate(3); f.seek(0)
assert f.read() == b'XYZ'
assert os.fstat(f.fileno()).st_size == 3
f.close()
with open('append', 'wb') as f: f.write(b'A')
with open('append', 'a+b') as f:
 f.seek(0); assert f.read() == b'A'
 f.write(b'B'); f.flush(); assert f.tell() == 2
assert Path('append').read_bytes() == b'AB'
assert Path('append').stat().st_size == 2
assert Path('append').stat().st_blocks is None
os.utime('append', (1.25, 2.75))
assert Path('append').stat().st_mtime_ns == 2750000000
for invalid in ('append/', 'append/.'):
 try: open(invalid, 'rb')
 except NotADirectoryError: pass
 else: raise AssertionError('lost terminal directory syntax')
try: open('append', 'xb')
except FileExistsError: pass
else: raise AssertionError('exclusive create replaced existing file')
with tempfile.NamedTemporaryFile() as f:
 f.write(b'temp');f.flush()
 assert Path(f.name).read_bytes() == b'temp'
assert 'append' in os.listdir('.')
with os.scandir('.') as entries:
 assert any(entry.name == 'append' and entry.is_file() for entry in entries)
assert any('append' in files for _, _, files in os.walk('.'))
assert any(path.name == 'append' for path in Path('.').iterdir())
try: Path('/.pyodide-runtime/forbidden').write_bytes(b'no')
except OSError as error: assert error.errno == errno.EROFS
else: raise AssertionError('writable runtime namespace')
import helper
assert helper.answer == 42
print('file passed')
`));
 const shell=new Shell({fs,cwd:'/work'}).use(agentCommands()).use(pythonCommands({createWorker}));
 for(const [command,expected] of [
  ['python "document café.py" "two words"','file passed\n'],
  ["python3 -c 'print(6 * 7)'",'42\n'],
  ["printf 'print(21 * 2)' | python -",'42\n'],
  ["printf '{\"a\":1}' | python -m json.tool",'{\n    "a": 1\n}\n'],
 ]) {
  await t.test(command, async()=>{
   const result=await shell.exec(command);
   assert.equal(result.exitCode,0,command+'\n'+result.stderr);
   assert.equal(result.stdout,expected);
  });
 }
 assert.deepEqual(Array.from(await fs.readFile('/work/append')),[65,66]);
});

import { createBytePipe } from '../../../src/contracts/io.ts';

function trackedRuntime(onMessage = () => {}) {
 const storage = new MemoryFileSystem();
 const handles = new Set();
 let terminated = 0;
 const fs = new Proxy(storage, {get(target,key){
  if(key === 'open') return async (...args)=>{
   const handle=await target.open(...args);handles.add(handle);
   return new Proxy(handle,{get(retained,member){
    if(member === 'close') return async()=>{try{await retained.close();}finally{handles.delete(handle);}};
    const value=Reflect.get(retained,member,retained);return typeof value === 'function' ? value.bind(retained) : value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value === 'function' ? value.bind(target) : value;
 }});
 return {fs,handles,terminated:()=>terminated,createWorker(){
  const endpoint=createWorker();
  return {postMessage:value=>endpoint.postMessage(value),subscribe(listener,error){return endpoint.subscribe(value=>{listener(value);onMessage(value);},error);},async terminate(){await endpoint.terminate();terminated++;}};
 }};
}

for(const stream of ['stdin','stdout','stderr']) {
 test(`public Python cancellation retires handles while blocked on ${stream}`,{timeout:15000},async context=>{
  const controller=new AbortController();
  const pipes=Object.fromEntries(['stdin','stdout','stderr'].map(name=>[name,createBytePipe({highWaterMark:1,signal:controller.signal})]));
  let ready;
  const blocked=new Promise(resolve=>{ready=resolve;});
  let requests=0;
  const runtime=trackedRuntime(message=>{if(message.op===stream && ++requests === (stream==='stdin'?1:2))ready();});
  const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker}));
  const script="import os; held=open('/held','w+b'); held.write(b'owned'); held.flush(); "+(stream==='stdin'?"os.read(0,1)":`os.write(${stream==='stdout'?1:2},b'a'); os.write(${stream==='stdout'?1:2},b'b')`);
  const running=shell.exec("python -c '"+script.split("'").join("'\\''")+"'",{signal:controller.signal,stdin:pipes.stdin.readable,stdout:pipes.stdout.writable,stderr:pipes.stderr.writable});
  const reason={cancelled:stream};
  const settlement=assert.rejects(running,error=>error===reason);
  context.after(async()=>{controller.abort(reason);await Promise.allSettled([running,...Object.values(pipes).map(pipe=>pipe.abort(reason))]);});
  await blocked;
  assert.equal(runtime.handles.size,1,'Python retained an application file before blocking');
  const started=performance.now();
  controller.abort(reason);
  await settlement;
  assert.equal(runtime.handles.size,0);
  assert.equal(runtime.terminated(),1);
  assert.ok(performance.now()-started<2000,'cooperative cancellation must retire promptly');
 });
}

test('public Python exchanges bidirectional binary bytes through one-byte shell pipes',{timeout:15000},async context=>{
 const controller=new AbortController();
 const pipes=Object.fromEntries(['stdin','stdout','stderr'].map(name=>[name,createBytePipe({highWaterMark:1,signal:controller.signal})]));
 const runtime=trackedRuntime();
 const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker}));
 const script="import os\nfor i in range(32):\n b=os.read(0,1)\n os.write(1,b)\n os.write(2,b)\nassert os.read(0,1)==b''\n";
 const running=shell.exec("python -c '"+script.split("'").join("'\\''")+"'",{signal:controller.signal,stdin:pipes.stdin.readable,stdout:pipes.stdout.writable,stderr:pipes.stderr.writable});
 context.after(async()=>{controller.abort('test cleanup');await Promise.allSettled([running,...Object.values(pipes).map(pipe=>pipe.abort('test cleanup'))]);});
 const out=pipes.stdout.readable[Symbol.asyncIterator]();
 const err=pipes.stderr.readable[Symbol.asyncIterator]();
 for(let index=0;index<32;index++) {
  const byte=Uint8Array.of(index*8);
  await pipes.stdin.writable.write(byte);
  assert.deepEqual((await out.next()).value,byte);
  assert.deepEqual((await err.next()).value,byte);
 }
 await pipes.stdin.close();
 assert.equal((await running).exitCode,0);
 assert.equal(runtime.handles.size,0);
 assert.equal(runtime.terminated(),1);
 await out.return();await err.return();
});

test('public Python ordinary open preserves canonical directory errors',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');
 const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker}));
 const script="try:\n open('/work','rb')\nexcept IsADirectoryError:\n print('EISDIR')\n";
 const result=await shell.exec("python -c '"+script.split("'").join("'\\''")+"'");
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'EISDIR\n');
});

test('public Python exclusive creation preserves existing entries and final symlinks',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();
 await fs.mkdir('/work');await fs.mkdir('/work/directory');
 await fs.writeFile('/work/regular',Uint8Array.of(1,2,3));
 await fs.symlink('missing','/work/dangling');await fs.symlink('self','/work/self');await fs.symlink('regular','/work/link');
 const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker}));
 const script="for name in ('regular','directory','dangling','self','link'):\n try:\n  open(name,'xb')\n except FileExistsError:\n  pass\n else:\n  raise AssertionError(name)\n";
 const result=await shell.exec("python -c '"+script.split("'").join("'\\''")+"'");
 assert.equal(result.exitCode,0,result.stderr);
 assert.deepEqual(Array.from(await fs.readFile('/work/regular')),[1,2,3]);
 assert.equal(await fs.readlink('/work/dangling'),'missing');
 assert.equal(await fs.readlink('/work/self'),'self');
});

test('public Python descriptor aliases, sparse writes and cwd preserve ordinary file semantics',{timeout:15000},async()=>{
 const runtime=trackedRuntime();
 await runtime.fs.mkdir('/work');await runtime.fs.mkdir('/work/nested');
 const shell=new Shell({fs:runtime.fs,cwd:'/work'}).use(pythonCommands({createWorker:runtime.createWorker}));
 const script=`
import os, errno
from pathlib import Path
os.chdir('nested')
assert os.getcwd() == '/work/nested'
os.symlink('nested', '../alias')
os.chdir('../alias/..')
assert os.getcwd() == '/work'
fd = os.open('sparse', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
assert os.write(fd, b'abcdef') == 6
other = os.dup(fd)
assert os.lseek(other, 0, os.SEEK_SET) == 0
assert os.read(fd, 2) == b'ab'
assert os.read(other, 2) == b'cd'
os.close(fd)
assert os.read(other, 2) == b'ef'
os.lseek(other, 10, os.SEEK_SET)
os.write(other, b'Z')
os.ftruncate(other, 12)
os.lseek(other, 0, os.SEEK_SET)
assert os.read(other, 20) == b'abcdef\\0\\0\\0\\0Z\\0'
os.close(other)
try: os.read(other, 1)
except OSError as error: assert error.errno == errno.EBADF
else: raise AssertionError('closed descriptor remained live')
assert Path('sparse').read_bytes() == b'abcdef\\0\\0\\0\\0Z\\0'
print('descriptor edges passed')
`;
 const result=await shell.exec("python -c '"+script.split("'").join("'\\''")+"'");
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'descriptor edges passed\n');
 assert.equal(runtime.handles.size,0);
 assert.equal(runtime.terminated(),1);
});

test('public Python exception closes unclosed application descriptors',{timeout:15000},async()=>{
 const runtime=trackedRuntime();
 const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker}));
 const result=await shell.exec(`python -c 'held=open("/held","wb",buffering=0); held.write(b"persisted"); raise RuntimeError("user failure")'`);
 assert.equal(result.exitCode,1);
 assert.match(result.stderr,/RuntimeError: user failure/);
 assert.deepEqual(await runtime.fs.readFile('/held'),new TextEncoder().encode('persisted'));
 assert.equal(runtime.handles.size,0);
 assert.equal(runtime.terminated(),1);
});

test('direct Python command initial cwd resolves symlink traversal before dot segments',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();
 await fs.mkdir('/work');await fs.mkdir('/deep');await fs.mkdir('/deep/nested');
 await fs.symlink('/deep/nested','/work/link');
 await fs.writeFile('/deep/file',new TextEncoder().encode('canonical'));
 await fs.writeFile('/work/file',new TextEncoder().encode('lexical decoy'));
 const output=[];const errors=[];
 const command=createPythonCommands({createWorker})[0];
 const result=await command.execute({fs,cwd:'/work/link/..',command:'python',args:['-c','import os; from pathlib import Path; print(os.getcwd()); print(Path("file").read_text())'],env:{},signal:new AbortController().signal,
  stdin:(async function*(){})(),stdout:{async write(bytes){output.push(new TextDecoder().decode(bytes));}},stderr:{async write(bytes){errors.push(new TextDecoder().decode(bytes));}}});
 assert.equal(result.exitCode,0,errors.join(''));
 assert.equal(output.join(''),'/deep\ncanonical\n');
});

test('public Python buffered files handle delayed partial descriptor reads and writes',{timeout:15000},async()=>{
 const storage=new MemoryFileSystem();
 await storage.mkdir('/work');
 let reads=0,writes=0;
 const fs=new Proxy(storage,{get(target,key){
  if(key==='open') return async(...args)=>{
   const handle=await target.open(...args);
   return new Proxy(handle,{get(retained,member){
    if(member==='read'||member==='write') return async(buffer,position,options)=>{
     await new Promise(resolve=>setTimeout(resolve,1));
     if(member==='read') reads++;else writes++;
     return retained[member](buffer.subarray(0,3),position,options);
    };
    const value=Reflect.get(retained,member,retained);return typeof value==='function'?value.bind(retained):value;
   }});
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker}));
 const script=`
from pathlib import Path
payload = bytes(range(64))
with open('partial', 'wb') as f:
 assert f.write(payload) == len(payload)
with open('partial', 'rb') as f:
 assert f.read(20) == payload[:20]
 f.seek(17)
 assert f.read() == payload[17:]
with open('partial', 'ab') as f:
 assert f.write(b'append') == 6
assert Path('partial').read_bytes() == payload + b'append'
print('partial I/O passed')
`;
 const result=await shell.exec("python -c '"+script.split("'").join("'\\''")+"'");
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'partial I/O passed\n');
 assert.ok(reads>20);assert.ok(writes>20);
 assert.deepEqual(await storage.readFile('/work/partial'),Uint8Array.from([...Array.from({length:64},(_,index)=>index),...new TextEncoder().encode('append')]));
});

import { MountFileSystem, ReadOnlyFileSystem } from 'poe-code/safe-fs/core';

test('public Python mounted and readonly backends preserve caller authority',{timeout:15000},async()=>{
 const root=new MemoryFileSystem();const mounted=new MemoryFileSystem();const protectedStorage=new MemoryFileSystem();
 await root.mkdir('/work');await protectedStorage.writeFile('/kept',new TextEncoder().encode('unchanged'));
 const fs=new MountFileSystem({root,mounts:{'/mounted':mounted,'/protected':new ReadOnlyFileSystem(protectedStorage)}});
 const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker}));
 const script=`
import os, errno
from pathlib import Path
assert Path('/protected/kept').read_text() == 'unchanged'
for mode in ('wb', 'ab', 'r+b'):
 try: open('/protected/kept', mode)
 except OSError as error: assert error.errno == errno.EROFS
 else: raise AssertionError('readonly mutation admitted')
Path('/mounted/data').write_bytes(b'mounted bytes')
assert Path('/mounted/data').read_bytes() == b'mounted bytes'
try: os.rename('/mounted/data', '/work/moved')
except OSError as error: assert error.errno == errno.EXDEV
else: raise AssertionError('cross-backend rename admitted')
print('backend authority passed')
`;
 const result=await shell.exec("python -c '"+script.split("'").join("'\\''")+"'");
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'backend authority passed\n');
 assert.deepEqual(await mounted.readFile('/data'),new TextEncoder().encode('mounted bytes'));
 assert.deepEqual(await protectedStorage.readFile('/kept'),new TextEncoder().encode('unchanged'));
});

const pythonQuote = value => "'" + value.split("'").join("'\\''") + "'";

test('user edge: caller cancellation terminates a Python producer spinning after downstream closure',{timeout:15000},async context=>{
 const runtime=trackedRuntime();
 const controller=new AbortController();
 const shell=new Shell({fs:runtime.fs}).use(agentCommands()).use(pythonCommands({createWorker:runtime.createWorker}));
 const source='import os\nheld=open("/held","wb",buffering=0)\nheld.write(b"kept")\nos.write(1,b"first\\n")\nwhile True: pass\n';
 let reached;
 const output=new Promise(resolve=>{reached=resolve;});
 const reason=new Error('cancel producer after consumer closes');
 const running=shell.exec('python -c '+pythonQuote(source)+' | head -n 1',{signal:controller.signal,stdout:{async write(bytes){assert.equal(new TextDecoder().decode(bytes),'first\n');reached();}}});
 const rejected=assert.rejects(running,error=>error===reason);
 void rejected.catch(()=>{});
 context.after(async()=>{controller.abort('test cleanup');await Promise.allSettled([running]);});
 await output;
 await new Promise(resolve=>setTimeout(resolve,50));
 const started=performance.now();
 controller.abort(reason);await rejected;
 assert.ok(performance.now()-started<2000);
 assert.equal(runtime.handles.size,0);
 assert.equal(runtime.terminated(),1);
 const recovery=await shell.exec('python -c '+pythonQuote('print("after pipe")'));
 assert.equal(recovery.exitCode,0,recovery.stderr);
 assert.equal(recovery.stdout,'after pipe\n');
});

test('user edge: a continuously writing Python producer retires after head closes its pipe',{timeout:15000},async context=>{
 const runtime=trackedRuntime();
 const controller=new AbortController();
 const shell=new Shell({fs:runtime.fs}).use(agentCommands()).use(pythonCommands({createWorker:runtime.createWorker,maxTransferBytes:1024}));
 const source='import os\nheld=open("/held","wb",buffering=0)\nwhile True: os.write(1,b"line\\n"*256)\n';
 const running=shell.exec('python -c '+pythonQuote(source)+' | head -n 1',{signal:controller.signal,limits:{pipeHighWaterMark:1}});
 context.after(async()=>{controller.abort('test cleanup');await Promise.allSettled([running]);});
 const result=await running;
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'line\n');
 assert.equal(runtime.handles.size,0);assert.equal(runtime.terminated(),1);
});

test('user edge: two concurrent binary Python pipelines progress at full worker capacity',{timeout:20000},async context=>{
 const runtime=trackedRuntime();
 const controller=new AbortController();
 const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker,maxConcurrentWorkers:4,maxTransferBytes:1024}));
 let arrivals=0,release;
 const both=new Promise(resolve=>{release=resolve;});
 const running=[17,241].map(async byte=>{
  let received=0;
  const producer=`import os\nfor _ in range(128): os.write(1, bytes([${byte}])*1024)\n`;
  const consumer='import os\nwhile True:\n b=os.read(0,733)\n if not b: break\n os.write(1,b)\n';
  const result=await shell.exec('python -c '+pythonQuote(producer)+' | python3 -c '+pythonQuote(consumer),{
   signal:controller.signal,
   limits:{pipeHighWaterMark:1},
   stdout:{async write(bytes){
    if(received===0){if(++arrivals===2)release();await both;}
    assert.ok(bytes.length<=1024);
    assert.ok(bytes.every(value=>value===byte));
    received+=bytes.length;
   }},
  });
  assert.equal(result.exitCode,0,result.stderr);
  assert.equal(received,128*1024,result.stderr);
  return result;
 });
 context.after(async()=>{controller.abort('test cleanup');release();await Promise.allSettled(running);});
 const results=await Promise.all(running);
 assert.deepEqual(results.map(result=>result.exitCode),[0,0]);
 assert.equal(runtime.terminated(),4);
 assert.equal(runtime.handles.size,0);
});

test('user edge: aborting one blocked interpreter preserves its sibling and frees only its capacity',{timeout:20000},async context=>{
 const runtime=trackedRuntime();
 const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker,maxConcurrentWorkers:2}));
 const controllers=[new AbortController(),new AbortController()];
 const pipes=controllers.map(controller=>createBytePipe({highWaterMark:1,signal:controller.signal}));
 let arrivals=0,release;
 const both=new Promise(resolve=>{release=resolve;});
 const source='import os, builtins\nbuiltins.private=True\nheld=open(os.environ["NAME"],"wb",buffering=0)\nos.write(1,b"ready")\nb=os.read(0,1)\nheld.write(b)\nheld.close()\nos.write(1,b)';
 const outputs=[[],[]];
 const running=controllers.map((controller,index)=>shell.exec('python -c '+pythonQuote(source),{
  env:{NAME:'/held-'+index},signal:controller.signal,stdin:pipes[index].readable,
  stdout:{async write(bytes){outputs[index].push(Uint8Array.from(bytes));if(outputs[index].length===1&&++arrivals===2)release();}},
 }));
 const reason=new Error('cancel only first interpreter');
 const rejected=assert.rejects(running[0],error=>error===reason);
 void rejected.catch(()=>{});
 context.after(async()=>{controllers.forEach(controller=>controller.abort(reason));await Promise.allSettled([...running,...pipes.map(pipe=>pipe.abort(reason))]);});
 await both;
 const refused=await shell.exec('python3 -c '+pythonQuote('print("not admitted")'));
 assert.equal(refused.exitCode,1);assert.match(refused.stderr,/worker capacity exhausted/);
 controllers[0].abort(reason);await rejected;
 assert.equal(runtime.terminated(),1);assert.equal(runtime.handles.size,1);
 const recovery=await shell.exec('python -c '+pythonQuote('import builtins; assert not hasattr(builtins,"private"); print("replacement")'));
 assert.equal(recovery.exitCode,0,recovery.stderr);assert.equal(recovery.stdout,'replacement\n');
 assert.equal(runtime.handles.size,1);
 await pipes[1].writable.write(Uint8Array.of(255));await pipes[1].close();
 assert.equal((await running[1]).exitCode,0);
 assert.deepEqual(outputs[1],[new TextEncoder().encode('ready'),Uint8Array.of(255)]);
 assert.equal(outputs[0].length,1);
 assert.deepEqual(await runtime.fs.readFile('/held-1'),Uint8Array.of(255));
 assert.equal(runtime.handles.size,0);assert.equal(runtime.terminated(),3);
});

for (const mode of ['CPU loop', 'import CPU loop']) {
 test(`hardening: cancellation terminates an ordinary ${mode} and the next command succeeds`, {timeout:15000}, async context => {
  const controller = new AbortController();
  let reached;
  const executing = new Promise(resolve => { reached = resolve; });
  const runtime = trackedRuntime(message => { if (message.op === 'stdout') reached(); });
  await runtime.fs.mkdir('/work');
  const loop = 'import os\nheld=open("/work/held","wb",buffering=0)\nheld.write(b"before abort")\nos.write(1,b"running")\nwhile True: pass\n';
  await runtime.fs.writeFile('/work/loop.py',new TextEncoder().encode(loop));
  const shell = new Shell({fs:runtime.fs,cwd:'/work'}).use(pythonCommands({createWorker:runtime.createWorker}));
  const writes=[];
  const running=shell.exec('python -c '+pythonQuote(mode === 'CPU loop' ? loop : 'import loop'),{signal:controller.signal,stdout:{async write(bytes){writes.push(Uint8Array.from(bytes));}}});
  const reason=new Error(mode+' cancellation');
  const settlement=assert.rejects(running,error=>error===reason);
  void settlement.catch(()=>{});
  context.after(async()=>{controller.abort(reason);await Promise.allSettled([running]);});
  await Promise.race([executing,running.then(result=>{throw new Error("Python exited before entering CPU loop: "+result.stderr);})]);
  // Let Python resume past its synchronous stdout callback into the non-awaiting loop.
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(runtime.handles.size,1);
  const started=performance.now();
  controller.abort(reason);
  await settlement;
  assert.ok(performance.now()-started<2000,'termination must interrupt CPU execution');
  assert.equal(runtime.handles.size,0);
  assert.equal(runtime.terminated(),1);
  const count=writes.length;
  const recovery=await shell.exec('python -c '+pythonQuote('import builtins; assert not hasattr(builtins,"leaked"); print("recovered")'));
  assert.equal(recovery.exitCode,0,recovery.stderr);
  assert.equal(recovery.stdout,'recovered\n');
  assert.equal(writes.length,count,'retired invocation cannot write during its successor');
  assert.equal(runtime.terminated(),2);
 });
}

test('hardening: concurrent Python producer and consumer stream binary data with backpressure and isolated globals',{timeout:20000},async()=>{
 const runtime=trackedRuntime();
 await runtime.fs.mkdir('/work');
 const shell=new Shell({fs:runtime.fs,cwd:'/work'}).use(agentCommands()).use(pythonCommands({createWorker:runtime.createWorker,maxTransferBytes:4096}));
 const producer='import os, builtins\nbuiltins.private=123\nblock=bytes(range(256))*16\nfor _ in range(256): os.write(1,block)\n';
 const consumer='import os, builtins\nassert not hasattr(builtins,"private")\nwhile True:\n chunk=os.read(0,4096)\n if not chunk: break\n os.write(1,chunk)\n os.write(2,chunk)\n';
 let out=0,err=0,active=0,maxActive=0;
 const sink=kind=>({async write(bytes){
  active++;maxActive=Math.max(maxActive,active);
  assert.ok(bytes.length<=4096,'bridge chunks remain bounded');
  const offset=kind==='out'?out:err;
  for(let i=0;i<bytes.length;i++) assert.equal(bytes[i],(offset+i)%256);
  await new Promise(resolve=>setTimeout(resolve,1));
  if(kind==='out')out+=bytes.length;else err+=bytes.length;
  active--;
 }});
 const result=await shell.exec('python -c '+pythonQuote(producer)+' | python3 -c '+pythonQuote(consumer),{
  stdout:sink('out'),stderr:sink('err'),limits:{pipeHighWaterMark:1024,maxOutputBytes:3*1024*1024},
 });
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(out,1024*1024);assert.equal(err,1024*1024);
 assert.equal(maxActive,1,'each worker awaits one output acknowledgement');
 assert.equal(runtime.handles.size,0);assert.equal(runtime.terminated(),2);
});

test('hardening: concurrent commands share canonical files while interpreter state and error recovery remain isolated',{timeout:20000},async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/work');
 let arrivals=0,release;
 const both=new Promise(resolve=>{release=resolve;});
 const workers=[];
 const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker(){const endpoint=createWorker();workers.push(endpoint);return endpoint;}}));
 const results=await Promise.all(['left','right'].map(name=>shell.exec('python -c '+pythonQuote(`import builtins, os\nassert not hasattr(builtins,"private")\nbuiltins.private="${name}"\nf=open("${name}","wb",buffering=0)\nf.write(b"${name}")\nos.write(1,b"ready")\nassert builtins.private=="${name}"\nf.close()\n`),{stdout:{async write(){if(++arrivals===2)release();await both;}}})));
 assert.deepEqual(results.map(result=>result.exitCode),[0,0]);
 assert.equal(workers.length,2);
 for(const name of ['left','right'])assert.equal(new TextDecoder().decode(await fs.readFile('/work/'+name)),name);
 const failure=await shell.exec('python -c '+pythonQuote('import builtins; builtins.private=1; raise RuntimeError("expected")'));
 assert.equal(failure.exitCode,1);assert.match(failure.stderr,/RuntimeError: expected/);
 const recovery=await shell.exec('python -c '+pythonQuote('import builtins; assert not hasattr(builtins,"private"); print("clean")'));
 assert.equal(recovery.exitCode,0,recovery.stderr);assert.equal(recovery.stdout,'clean\n');
});

test('hardening: cancellation retires a real worker during runtime initialization and permits recovery',{timeout:15000},async context=>{
 const controller=new AbortController();
 const reason=new Error('cancel initialization');
 let terminated=0,starting;
 const initialized=new Promise(resolve=>{starting=resolve;});
 const fs=new MemoryFileSystem();
 let first=true;
 const shell=new Shell({fs}).use(pythonCommands({createWorker(){
  const endpoint=createWorker({onInitialization:first?starting:undefined});first=false;
  return {...endpoint,async terminate(){await endpoint.terminate();terminated++;}};
 }}));
 const running=shell.exec('python -c '+pythonQuote('print("must not run")'),{signal:controller.signal});
 const rejected=assert.rejects(running,error=>error===reason);
  void rejected.catch(()=>{});
 context.after(async()=>{controller.abort(reason);await Promise.allSettled([running]);});
 await Promise.race([initialized,running.then(result=>{throw new Error("Python exited before initialization marker: "+result.stderr);})]);
 const started=performance.now();controller.abort(reason);await rejected;
 assert.equal(terminated,1);assert.ok(performance.now()-started<2000);
 const result=await shell.exec('python3 -c '+pythonQuote('print("initialized")'));
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'initialized\n');assert.equal(terminated,2);
});

for(const mode of ['filesystem', 'import filesystem']) {
 test(`hardening: cancellation retires retained handles in blocked ${mode} reads`,{timeout:15000},async context=>{
  const runtime=trackedRuntime();await runtime.fs.mkdir('/work');
  await runtime.fs.writeFile('/work/block.py',new TextEncoder().encode('value=42\n'));
  let entered,enabled=true;
  const blocked=new Promise(resolve=>{entered=resolve;});
  const fs=new Proxy(runtime.fs,{get(target,key){
   if(key==='open')return async(path,...args)=>{
    const handle=await target.open(path,...args);
    if(path!=='/work/block.py')return handle;
    return new Proxy(handle,{get(retained,member){
     if(member==='read')return async(...readArgs)=>{
      if(!enabled)return retained.read(...readArgs);
      const signal=readArgs[2]?.signal;
      assert.ok(signal,'filesystem operation receives invocation cancellation');
      return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();});
     };
     const value=Reflect.get(retained,member,retained);return typeof value==='function'?value.bind(retained):value;
    }});
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const controller=new AbortController();const reason=new Error('cancel blocked '+mode);
  const shell=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker:runtime.createWorker}));
  const source='held=open("held","wb",buffering=0); held.write(b"owned"); '+(mode==='filesystem'?'open("block.py","rb").read()':'import block');
  const running=shell.exec('python -c '+pythonQuote(source),{signal:controller.signal});
  const rejected=assert.rejects(running,error=>error===reason);
  void rejected.catch(()=>{});
  context.after(async()=>{controller.abort(reason);await Promise.allSettled([running]);});
  await Promise.race([blocked,running.then(result=>{throw new Error("Python exited before blocked filesystem read: "+result.stderr);})]);
  assert.ok(runtime.handles.size>=2);
  const started=performance.now();controller.abort(reason);await rejected;
  assert.ok(performance.now()-started<2000);assert.equal(runtime.handles.size,0);assert.equal(runtime.terminated(),1);
  enabled=false;
  const recovery=await shell.exec('python -c '+pythonQuote('import block; print(block.value)'));
  assert.equal(recovery.exitCode,0,recovery.stderr);assert.equal(recovery.stdout,'42\n');assert.equal(runtime.handles.size,0);
 });
}

test('hardening: default JS interoperability has no ambient host globals',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();
 const shell=new Shell({fs}).use(pythonCommands({createWorker}));
 const result=await shell.exec('python -c '+pythonQuote('import js\nfor name in ("process", "fetch", "require", "globalThis", "postMessage", "Worker"):\n assert not hasattr(js,name), "ambient host exposure: "+name\nprint("no ambient globals")'));
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'no ambient globals\n');
});

test('hardening: a pipeline above worker capacity refuses promptly and releases admission',{timeout:15000},async()=>{
 const runtime=trackedRuntime();
 const shell=new Shell({fs:runtime.fs}).use(pythonCommands({createWorker:runtime.createWorker,maxConcurrentWorkers:1}));
 const result=await shell.exec('python -c '+pythonQuote('import sys; sys.stdout.write("producer")')+' | python3 -c '+pythonQuote('import sys; print(sys.stdin.read())'));
 assert.equal(result.exitCode,1);
 assert.match(result.stderr,/worker capacity exhausted/);
 assert.equal(runtime.terminated(),1);
 const recovery=await shell.exec('python -c '+pythonQuote('print("admitted")'));
 assert.equal(recovery.exitCode,0,recovery.stderr);assert.equal(recovery.stdout,'admitted\n');assert.equal(runtime.terminated(),2);
});

test('hardening: native process and thread operations refuse execution explicitly',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();
 const shell=new Shell({fs}).use(pythonCommands({createWorker}));
 const source=`
import os, subprocess, threading, socket
for name, operation in (
 ('subprocess', lambda: subprocess.run(['safe_bash_unavailable_native_process'], check=True)),
 ('fork', os.fork),
 ('socket', socket.socket),
 ('thread', lambda: threading.Thread(target=lambda: None).start()),
):
 try:
  value = operation()
 except (OSError, RuntimeError) as error:
  print(name, type(error).__name__)
 else:
  raise AssertionError(name + ' unexpectedly returned ' + str(value))
assert os.system('exit 73') == -1, 'os.system must refuse native shell execution'
print('os.system refused')
import ctypes
assert ctypes.CDLL(None).system(b'exit 73') == -1, 'native ctypes must refuse host shell execution'
print('ctypes system refused')
`;
 const result=await shell.exec('python -c '+pythonQuote(source));
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'subprocess OSError\nfork OSError\nsocket OSError\nthread RuntimeError\nos.system refused\nctypes system refused\n');
});

test('hardening: public Pyodide host filesystem network and package helpers refuse ambient access',{timeout:15000},async()=>{
 const fs=new MemoryFileSystem();
 const shell=new Shell({fs}).use(pythonCommands({createWorker}));
 const source=`
import pyodide_js
assert not hasattr(pyodide_js.FS.filesystems, 'NODEFS')
assert pyodide_js._module.__emscripten_system(0) == 0
try:
 pyodide_js._module.SOCKFS.createSocket()
except Exception as error:
 assert 'Host filesystem and native socket capabilities are unavailable' in str(error), str(error)
else:
 raise AssertionError('SOCKFS admitted ambient socket creation')
for name in ('mountNodeFS', 'mountNativeFS', 'useNodeSockFS', 'loadPackage'):
 try:
  getattr(pyodide_js, name)()
 except Exception as error:
  expected = 'Python package transport is only available during installation' if name == 'loadPackage' else 'Host filesystem and native socket capabilities are unavailable'
  assert expected in str(error), str(error)
  print(name, 'refused')
 else:
  raise AssertionError(name + ' admitted ambient access')
`;
 const result=await shell.exec('python -c '+pythonQuote(source));
 assert.equal(result.exitCode,0,result.stderr);
 assert.equal(result.stdout,'mountNodeFS refused\nmountNativeFS refused\nuseNodeSockFS refused\nloadPackage refused\n');
});
