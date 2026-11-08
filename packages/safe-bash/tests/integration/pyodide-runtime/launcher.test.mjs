import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Shell} from '../../../src/core.ts';
import {MemoryFileSystem} from 'poe-code/safe-fs/core';
import {pythonCommands} from '../../../src/commands/python/index.ts';
import {Worker} from 'node:worker_threads';

function createNodePythonWorker({runtimeModuleURL}) {
 const worker = new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 parentPort.once('message',async start=>{try {
 const {register}=await import('tsx/esm/api');register();
 const {runPythonWorker}=await import(workerData.runner);
 const {loadPyodide}=await import(workerData.runtimeModuleURL);
 await runPythonWorker({start,loadRuntime:configuration=>loadPyodide({...configuration,indexURL:new URL('.',workerData.runtimeModuleURL).pathname}),postMessage:m=>parentPort.postMessage(m)});
 }catch(e){parentPort.postMessage({type:'error',message:String(e)});}});`,{eval:true,execArgv:[],workerData:{runtimeModuleURL,runner:new URL('../../../src/commands/python/worker.ts',import.meta.url).href}});
 return {postMessage:m=>worker.postMessage(m),subscribe(message,error){worker.on('message',message);worker.on('error',error);return()=>{worker.off('message',message);worker.off('error',error)}},terminate:()=>worker.terminate()};
}
const runtimeModuleURL = new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href;
async function shell() {
 const fs = new MemoryFileSystem(); await fs.mkdir('/work');
 return {fs, shell:new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker:()=>createNodePythonWorker({runtimeModuleURL})}))};
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
test('Python launcher uses a real main module for code and stdin, with source encoding', async()=>{
 const {shell:s}=await shell();
 for (const command of ['python -c '+quote('import __main__; assert __main__.__dict__ is globals(); assert __package__ is None; print("ok")'), 'python -']) {
  const result=await s.exec(command,{stdin:Buffer.from('# coding: latin-1\nprint("caf\xe9")\n','latin1')});
  assert.equal(result.exitCode,0,result.stderr); assert.equal(result.stdout,command==='python -'?'café\n':'ok\n');
 }
});
test('Python launcher supports option termination and rejects unsupported startup flags',async()=>{
 const {fs,shell:s}=await shell(); await fs.writeFile('/work/-file.py',new TextEncoder().encode('print("file")'));
 assert.equal((await s.exec('python -- -file.py')).stdout,'file\n');
 for(const flag of ['-X','-i','-x','-t','-U','--invalid']) {
  const result=await s.exec(`python ${flag}`); assert.equal(result.exitCode,2,`${flag}: ${result.stderr}`);
 }
});
test('Python launcher applies write-through output and warning filters',async()=>{
 const {shell:s}=await shell();
 const result=await s.exec('python -uB -Werror -c '+quote('import sys, warnings; assert sys.stdout.write_through; assert sys.dont_write_bytecode; warnings.warn("boom")'));
 assert.equal(result.exitCode,1,result.stderr); assert.match(result.stderr,/UserWarning: boom/);
});

test('Python native startup flags expose CPython flags and compiler semantics',async()=>{
 const {shell:s}=await shell();
 const result=await s.exec('python -BOOEP -c '+quote('import sys,json; print(json.dumps([sys.flags.optimize,__debug__,sys.flags.dont_write_bytecode,sys.flags.ignore_environment,sys.flags.safe_path,sys.flags.inspect]))'));
 assert.equal(result.exitCode,0,result.stderr); assert.deepEqual(JSON.parse(result.stdout),[2,false,1,1,true,0]);
});
test('built Node runtime adapter lazily starts and terminates a dedicated interpreter',async()=>{
 const {createNodePythonWorker:factory}=await import('../../../dist/commands/python/node.js');
 const fs=new MemoryFileSystem(); await fs.mkdir('/work');
 let starts=0;
 const s=new Shell({fs,cwd:'/work'}).use(pythonCommands({createWorker:()=>{starts++;return factory({runtimeModuleURL,trustedPython:true});}}));
 assert.equal(starts,0);
 const result=await s.exec('python -c '+quote('import sys; assert not sys.flags.inspect; print("node worker")'));
 assert.equal(result.exitCode,0,result.stderr); assert.equal(result.stdout,'node worker\n'); assert.equal(starts,1);
});
test('clustered help and version options terminate parsing',async()=>{
 const {shell:s}=await shell();
 for(const [command,pattern] of [['python -Bh ignored',/usage: python/],['python -BV ignored',/Python 3\./]]) {
  const result=await s.exec(command); assert.equal(result.exitCode,0,result.stderr); assert.match(result.stdout,pattern);
 }
});
test('help and version bypass environment restrictions that only apply to execution',async()=>{
 const {shell:s}=await shell();
 for(const env of [{PYTHONHOME:'/unavailable'}, {PYTHONINSPECT:'1'}]) {
  for(const [command,pattern] of [['python --help',/^usage: python/],['python --version',/^Python 3\./],['python -V -c '+quote('raise RuntimeError("must not execute")'),/^Python 3\./]]) {
   const result=await s.exec(command,{env});
   assert.equal(result.exitCode,0,`${command}: ${result.stderr}`);
   assert.match(result.stdout,pattern);
   assert.equal(result.stderr,'');
  }
 }
});
test('native isolation site and extended options are reflected by CPython',async()=>{
 const {shell:s}=await shell();
 for(const [flags,expression,expected] of [
  ['-IS','[sys.flags.isolated,sys.flags.no_site,sys.flags.no_user_site,sys.flags.safe_path]',[1,1,1,true]],
  ['-bb','[sys.flags.bytes_warning,sys.warnoptions]',[2,['error::BytesWarning']]],
  ['-Xutf8 -Xint_max_str_digits=640','[sys.flags.utf8_mode,sys.get_int_max_str_digits()]',[1,640]],
 ]) {
  const result=await s.exec('python '+flags+' -c '+quote('import sys,json; print(json.dumps('+expression+'))'));
  assert.equal(result.exitCode,0,result.stderr); assert.deepEqual(JSON.parse(result.stdout),expected);
 }
});
test('version flags accumulate while help exits immediately and invalid later flags fail',async t=>{
 const {shell:s}=await shell();
 const version=await s.exec('python -VV');
 for(const flags of ['-V -V','-VqV','--version -V']) await t.test(flags,async()=>{
  const result=await s.exec('python '+flags); assert.equal(result.exitCode,0,result.stderr); assert.equal(result.stdout,version.stdout);
 });
 for(const flags of ['-Vh','-V -h','-h -z']) await t.test(flags,async()=>{
  const result=await s.exec('python '+flags); assert.equal(result.exitCode,0,result.stderr); assert.match(result.stdout,/usage: python/);
 });
 await t.test('-V -z',async()=>{ const result=await s.exec('python -V -z'); assert.equal(result.exitCode,2,result.stderr); });
});
test('native BytesWarning filter retains precedence over deferred warning filters',async()=>{
 const {shell:s}=await shell();
 const result=await s.exec('python -bb -Wignore::BytesWarning -c '+quote('import sys,json; print(json.dumps(sys.warnoptions)); print(b"x" == "x")'));
 assert.deepEqual(JSON.parse(result.stdout),['ignore::BytesWarning','error::BytesWarning']);
 assert.equal(result.exitCode,1,result.stderr); assert.match(result.stderr,/BytesWarning/);
});
test('development defaults precede environment and command warning filters',async()=>{
 const {shell:s}=await shell();
 const result=await s.exec('python -Xdev -bb -Wignore -c '+quote('import sys,json,warnings; print(json.dumps(sys.warnoptions)); warnings.warn("suppressed"); print(b"x" == "x")'),{env:{PYTHONWARNINGS:'error'}});
 assert.deepEqual(JSON.parse(result.stdout),['default','error','ignore','error::BytesWarning']);
 assert.equal(result.exitCode,1,result.stderr); assert.match(result.stderr,/BytesWarning/); assert.doesNotMatch(result.stderr,/UserWarning: suppressed/);
});
test('SystemExit integers beyond native C long range return 255 without JS precision loss',async t=>{
 const {shell:s}=await shell();
 for(const value of ['2**64+7','-2**64','2**63','-1','257']) await t.test(value,async()=>{
  const result=await s.exec('python -c '+quote('raise SystemExit('+value+')'));
  assert.equal(result.exitCode,value==='257'?1:255,result.stderr); assert.equal(result.stderr,'');
 });
});
test('uncaught KeyboardInterrupt reports Python traceback and shell status 130',async()=>{
 const {shell:s}=await shell(); const result=await s.exec('python -c '+quote('raise KeyboardInterrupt'));
 assert.equal(result.exitCode,130,result.stderr); assert.match(result.stderr,/KeyboardInterrupt/);
});
test('bundled root SDK resolves the Python worker through the public package export',async()=>{
 const {runBash}=await import('../../../../../dist/index.js');
 const fs=new MemoryFileSystem(); await fs.mkdir('/work');
 const result=await runBash({fs,cwd:'/work',source:'python3 -c '+quote('print("bundled worker")'),python:{runtimeModuleURL,trustedPython:true}});
 assert.equal(result.exitCode,0,result.stderr); assert.equal(result.stdout,'bundled worker\n');
});
