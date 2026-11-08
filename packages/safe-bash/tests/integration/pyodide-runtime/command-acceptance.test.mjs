import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'node:worker_threads';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell, agentCommands } from '../../../src/core.ts';
import { pythonCommands } from '../../../src/commands/python/index.ts';

// Opt-in real Wasm integration. Application fixtures stay in canonical memory storage.
function createWorker() {
 const worker = new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 parentPort.once('message',async start=>{
 try {
 const {register}=await import('tsx/esm/api');register();
 const {runPythonWorker}=await import(workerData.runner);
 const {loadPyodide}=await import(workerData.loader);
 await runPythonWorker({loadRuntime:config=>loadPyodide({...config,indexURL:new URL('.',workerData.loader).pathname}),start,postMessage:m=>parentPort.postMessage(m)});
 }catch(e){parentPort.postMessage({type:'error',message:String(e)});}
 });`, {eval:true,execArgv:[],workerData:{runner:new URL('../../../src/commands/python/worker.ts',import.meta.url).href,loader:new URL('./node_modules/pyodide/pyodide.mjs',import.meta.url).href}});
 return {postMessage:value=>worker.postMessage(value),subscribe(listener,error){worker.on('message',listener);worker.on('error',error);return()=>{worker.off('message',listener);worker.off('error',error);};},async terminate(){await worker.terminate();}};
}
const quote = value => "'" + value.split("'").join("'\\''") + "'";
async function fixture() {
 const fs=new MemoryFileSystem(); await fs.mkdir('/work');
 const shell=new Shell({fs,cwd:'/work',onInternalError:error=>{ console.error(error); }}).use(agentCommands()).use(pythonCommands({createWorker}));
 return {fs,shell,run:(source,options)=>shell.exec('python -c '+quote(source),options)};
}
const metadata = `import sys, json, __main__
assert __main__.__dict__ is globals()
assert not sys.flags.inspect
print(json.dumps([__name__, globals().get('__file__'), __package__, sys.argv, sys.path[0]]))`;

test('entrypoint metadata and importable __main__ follow Python execution modes', async t=>{
 const {fs,shell,run}=await fixture();
 await fs.writeFile('/work/file.py',new TextEncoder().encode(metadata));
 await fs.mkdir('/work/pkg');
 await fs.writeFile('/work/pkg/__init__.py',new Uint8Array());
 await fs.writeFile('/work/pkg/__main__.py',new TextEncoder().encode(metadata));
 for(const [name,command,input,expected] of [
  ['inline','python -c '+quote(metadata)+' x',undefined,['__main__',null,null,['-c','x'],'']],
  ['file','python file.py x',undefined,['__main__','/work/file.py',null,['file.py','x'],'/work']],
  ['stdin explicit','python - x',metadata,['__main__','<stdin>',null,['-','x'],'']],
  ['stdin implicit','python',metadata,['__main__','<stdin>',null,[''],'']],
  ['module','python -m pkg x',undefined,['__main__','/work/pkg/__main__.py','pkg',['/work/pkg/__main__.py','x'],'/work']],
  ['directory','python pkg x',undefined,['__main__','/work/pkg/__main__.py','',['pkg','x'],'/work/pkg']],
 ]) await t.test(name,async()=>{
  const result=await shell.exec(command,{stdin:input});
  assert.equal(result.exitCode,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);
 });
 await run("import zipfile; z=zipfile.ZipFile('app.zip','w'); z.writestr('__main__.py',"+JSON.stringify(metadata)+"); z.close()");
 await t.test('zip',async()=>{
  const result=await shell.exec('python app.zip x');assert.equal(result.exitCode,0,result.stderr);
  const actual=JSON.parse(result.stdout);assert.equal(actual[0],'__main__');assert.equal(actual[1],'/work/app.zip/__main__.py');assert.deepEqual(actual[3],['app.zip','x']);
 });
});

test('source bytes honor encoding declarations for files and stdin',async t=>{
 const {fs,shell}=await fixture();
 const source=Uint8Array.from(Buffer.from("# coding: latin-1\nprint('caf\xe9')\n",'latin1'));
 await fs.writeFile('/work/latin.py',source);
 for(const command of ['python latin.py','python -','python']) await t.test(command,async()=>{
  const result=await shell.exec(command,{stdin:source});assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'café\n');
 });
});

test('exit values errors and shell status are preserved',async t=>{
 const {shell,run}=await fixture();
 for(const [value,code,error] of [['None',0,''],['7',7,''],['-1',255,''],['256',0,''],["'failure'",1,'failure\n']]) await t.test('SystemExit '+value,async()=>{
  const result=await run('raise SystemExit('+value+')');assert.equal(result.exitCode,code);assert.equal(result.stderr,error);
 });
 for(const [name,command,status,diagnostic] of [
  ['syntax','python -c '+quote('if True'),1,'SyntaxError'],
  ['runtime','python -c '+quote("raise RuntimeError('guest failure')"),1,'RuntimeError: guest failure'],
  ['missing file','python absent.py',2,'absent.py'],
  ['missing module','python -m absent_module',1,'No module named absent_module'],
 ]) await t.test(name,async()=>{const result=await shell.exec(command);assert.equal(result.exitCode,status,result.stderr);assert.ok(result.stderr.includes(diagnostic),result.stderr);});
 await t.test('shell status',async()=>{const result=await shell.exec("python -c 'raise SystemExit(7)'; echo $?");assert.equal(result.stdout,'7\n');assert.equal(result.exitCode,0);});
});

test('source stdin is consumed while inline stdin remains raw guest data',async t=>{
 const {shell,run}=await fixture();
 await t.test('raw bytes',async()=>{const bytes=Uint8Array.of(0,255,128,10,13);const result=await run('import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())',{stdin:bytes});assert.equal(result.exitCode,0,result.stderr);assert.deepEqual(result.stdoutBytes,bytes);});
 await t.test('input and EOF',async()=>{const result=await run("print(input('prompt:')); print(input())",{stdin:'hello\n'});assert.equal(result.stdout,'prompt:hello\n');assert.equal(result.exitCode,1);assert.ok(result.stderr.includes('EOFError'));});
 await t.test('source EOF',async()=>{const result=await shell.exec('python -',{stdin:"import sys; print(repr(sys.stdin.buffer.read()))"});assert.equal(result.stdout,"b''\n");assert.equal(result.exitCode,0,result.stderr);});
 await t.test('noninteractive',async()=>{const result=await run('import sys; print(sys.stdin.isatty(), sys.stdout.isatty(), sys.stderr.isatty())');assert.equal(result.stdout,'False False False\n');});
});

test('fresh invocations isolate modules environment cwd and interpreter global mutation',async()=>{
 const {fs,run}=await fixture();await fs.mkdir('/work/other');await fs.writeFile('/work/local.py',new TextEncoder().encode('value=1\n'));
 const first=await run("import os, sys, builtins, local; local.value=99; builtins.changed=True; os.environ['LEAK']='yes'; os.chdir('other'); sys.path[:]=[]; print('mutated')");
 assert.equal(first.exitCode,0,first.stderr);
 await fs.writeFile('/work/local.py',new TextEncoder().encode('value=222\n'));
 const second=await run("import os, builtins, local; assert not hasattr(builtins,'changed'); assert 'LEAK' not in os.environ; assert os.getcwd()=='/work'; assert local.value==222; print('isolated')");
 assert.equal(second.exitCode,0,second.stderr);assert.equal(second.stdout,'isolated\n');
});

test('shell pipes redirects and buffered broken-pipe statuses preserve bytes',async t=>{
 const {fs,shell,run}=await fixture();
 await t.test('pipe raw bytes and redirect',async()=>{
  const result=await shell.exec("python -c 'import sys; sys.stdout.buffer.write(bytes([0,255,128,10]))' | python -c 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())' > captured");
  assert.equal(result.exitCode,0,result.stderr);assert.deepEqual(await fs.readFile('/work/captured'),Uint8Array.of(0,255,128,10));
 });
 await t.test('redirect input and stderr',async()=>{
  await fs.writeFile('/work/data',Uint8Array.of(255,0));
  const result=await shell.exec("python -c 'import sys; sys.stderr.buffer.write(sys.stdin.buffer.read())' < data 2> errors");
  assert.equal(result.exitCode,0,result.stderr);assert.deepEqual(await fs.readFile('/work/errors'),Uint8Array.of(255,0));
 });
 await t.test('flush after SystemExit',async()=>{const result=await run("print('before'); raise SystemExit(4)");assert.equal(result.stdout,'before\n');assert.equal(result.exitCode,4);});
 for(const [flags,expected] of [['',120],['-u ',1]]) await t.test('broken stdout '+flags,async()=>{
  const result=await shell.exec('python '+flags+'-c '+quote("print('output')"),{stdout:{async write(){throw Object.assign(new Error('pipe closed'),{code:'EPIPE'});}}});
  assert.equal(result.exitCode,expected,result.stderr);
 });
});

test('Python shebang resolution executes canonical encoded source',async t=>{
 const {fs,shell}=await fixture();
 for(const interpreter of ['/usr/bin/python3 -u','/usr/bin/env python','/usr/bin/env -S python3 -u']) await t.test(interpreter,async()=>{
  await fs.writeFile('/work/script',Buffer.from('#!'+interpreter+'\n# coding: latin-1\nimport sys\nprint("caf\xe9",sys.argv[1])\n','latin1'),{mode:0o755});
  const result=await shell.exec('./script "two words"');assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'café two words\n');
 });
});

test('canonical Python environment paths and stream encoding obey E and I',async t=>{
 const {fs,shell}=await fixture();await fs.mkdir('/library');await fs.writeFile('/library/helper.py',new TextEncoder().encode('value=42\n'));
 const env={PYTHONPATH:'/library',PYTHONIOENCODING:'latin-1',APPLICATION_VALUE:'inherited'};
 await t.test('paths environment and output encoding',async()=>{
  const result=await shell.exec('python -c '+quote("import helper, os; assert helper.value==42; assert os.environ['APPLICATION_VALUE']=='inherited'; print('café')"),{env});
  assert.equal(result.exitCode,0,result.stderr);assert.deepEqual(result.stdoutBytes,Uint8Array.of(99,97,102,233,10));
 });
 for(const flag of ['-E','-I']) await t.test(flag,async()=>{
  const result=await shell.exec('python '+flag+' -c '+quote("import importlib.util, os; assert importlib.util.find_spec('helper') is None; assert os.environ['PYTHONPATH']=='/library'; print('café')"),{env});
  assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'café\n');
 });
});

test('closed shell pipe reports Python failure in PIPESTATUS',async()=>{
 const {shell}=await fixture();
 const result=await shell.exec('python -u -c '+quote('import os\nfor _ in range(100): os.write(1,b"abcdef")')+' | head -c 1; echo ${PIPESTATUS[@]}',{limits:{pipeHighWaterMark:1}});
 assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'a1 0\n');assert.ok(result.stderr.includes('BrokenPipeError'),result.stderr);
});

test('process shutdown runs atexit callbacks before final stream flushing',async t=>{
 const {run}=await fixture();
 for(const [ending,status] of [['',0],['raise SystemExit(7)',7],["raise RuntimeError('failure')",1]]) await t.test(ending || 'normal exit',async()=>{
  const result=await run("import atexit\natexit.register(print, 'last')\natexit.register(print, 'first')\nprint('body')\n"+ending);
  assert.equal(result.exitCode,status,result.stderr);assert.equal(result.stdout,'body\nfirst\nlast\n');
 });
});

test('uncaught exceptions call the guest exception hook with guest frames',async()=>{
 const {run}=await fixture();
 const result=await run("import sys\ndef hook(kind, value, trace):\n print(kind.__name__, str(value), trace.tb_frame.f_code.co_filename)\nsys.excepthook=hook\nraise ValueError('hooked')");
 assert.equal(result.exitCode,1,result.stderr);assert.equal(result.stdout,'ValueError hooked <string>\n');assert.equal(result.stderr,'');
});

test('option termination treats c and m spellings as script filenames',async()=>{
 const {fs,shell}=await fixture();
 for(const name of ['-c','-m']) {
  await fs.writeFile('/work/'+name,new TextEncoder().encode('import sys; print(sys.argv)'));
  const result=await shell.exec('python -- '+name+' argument');
  assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,"['"+name+"', 'argument']\n");
 }
});

test('process shutdown flushes an unclosed buffered application file',async()=>{
 const {fs,run}=await fixture();
 const result=await run("f=open('buffered.txt','w'); f.write('hello')");
 assert.equal(result.exitCode,0,result.stderr);assert.equal(new TextDecoder().decode(await fs.readFile('/work/buffered.txt')),'hello');
});

test('failing exception hooks report both exceptions and preserve failure status',async()=>{
 const {run}=await fixture();
 const result=await run("import sys\ndef hook(kind, value, trace):\n assert sys.last_exc is value\n raise RuntimeError('broken hook')\nsys.excepthook=hook\nraise ValueError('original')");
 assert.equal(result.exitCode,1,result.stderr);assert.ok(result.stderr.includes('Error in sys.excepthook:'),result.stderr);
 assert.ok(result.stderr.includes('RuntimeError: broken hook'),result.stderr);assert.ok(result.stderr.includes('Original exception was:'),result.stderr);assert.ok(result.stderr.includes('ValueError: original'),result.stderr);
});

test('native finalization preserves callback errors and shutdown flush status',async t=>{
 const {run,shell}=await fixture();
 await t.test('callback errors do not replace SystemExit',async()=>{
  const result=await run("import atexit\ndef failed():\n raise ValueError('exit callback')\natexit.register(print,'continued')\natexit.register(failed)\nraise SystemExit(7)");
  assert.equal(result.exitCode,7,result.stderr);assert.equal(result.stdout,'continued\n');assert.ok(result.stderr.includes('ValueError: exit callback'),result.stderr);
 });
 await t.test('buffered atexit output failure returns 120',async()=>{
  const result=await shell.exec('python -c '+quote("import atexit; atexit.register(print,'shutdown output')"),{stdout:{async write(){throw Object.assign(new Error('pipe closed'),{code:'EPIPE'});}}});
  assert.equal(result.exitCode,120,result.stderr);
 });
});

test('SystemExit from a guest exception hook selects process status',async()=>{
 const {run}=await fixture();
 const result=await run("import sys; sys.excepthook=lambda *args:sys.exit(7); raise ValueError('original')");
 assert.equal(result.exitCode,7,result.stderr);assert.equal(result.stderr,'');
});
