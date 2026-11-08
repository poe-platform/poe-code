import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createPythonJspiNativeCall } from '../../src/commands/python/jspi-trampoline.ts';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const tooling = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
assert.ok(tooling, 'Set SAFE_BASH_CF_RUNTIME_ROOT to the pinned workerd tooling');
assert.ok(process.env.TMPDIR?.startsWith(resolve(root, 'out') + '/'));
const require = createRequire(resolve(tooling, 'package.json'));
assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
assert.equal(require('workerd/package.json').version, '1.20260917.1');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const answerWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,
  7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
const wasmText = value => [value.length, ...new TextEncoder().encode(value)];
const wasmSection = (kind, bytes) => [kind, bytes.length, ...bytes];
const fetchBridge = new Uint8Array([0,97,115,109,1,0,0,0,
  ...wasmSection(1, [3,0x60,1,0x7f,1,0x6f,0x60,1,0x6f,1,0x6f,0x60,2,0x6f,0x6f,1,0x6f]),
  ...wasmSection(2, [5,...wasmText('host'),...wasmText('utf8'),0,0,
    ...wasmText('host'),...wasmText('fetch'),0,1,...wasmText('host'),...wasmText('then'),0,2,
    ...wasmText('host'),...wasmText('text'),3,0x6f,0,...wasmText('host'),...wasmText('allocate'),3,0x6f,0]),
  ...wasmSection(3, [1,0]),...wasmSection(7, [1,...wasmText('send'),0,3]),
  ...wasmSection(10, [1,16,0,0x20,0,0x10,0,0x10,1,0x23,0,0x10,2,0x23,1,0x10,2,0x0b]),
]);

const python = `
import json, sys, pyodide, pyodide_js, zlib
from js import Object
from pyodide.ffi import to_js
from workers import WorkerEntrypoint, Response
class Default(WorkerEntrypoint):
 async def fetch(self, request):
  result = {'python': sys.version.split()[0], 'pyodide': pyodide.__version__,
   'syscall_syncify': hasattr(pyodide_js._module, '_syscall_syncify'),
   'exposed_imports': hasattr(pyodide_js._module, 'wasmImports')}
  result['native_hooks'] = [name for name in dir(pyodide_js._module)
   if not name.startswith('___') and any(part in name.lower() for part in ['syscall', 'wasm', 'jspi', 'mount'])]
  result['api_hooks'] = [name for name in dir(pyodide_js._module.API)
   if any(part in name.lower() for part in ['syscall', 'wasm', 'jspi', 'mount', 'filesystem'])]
  result['filesystem_backends'] = list(Object.keys(pyodide_js._module.FS.filesystems))
  result['mount_native_fs'] = hasattr(pyodide_js, 'mountNativeFS')
  module = pyodide_js._module
  original_open = getattr(module, '___syscall_openat')
  try:
   setattr(module, '___syscall_openat', getattr(module, '___syscall_getpid'))
   result['replaced_export_result'] = getattr(module, '___syscall_openat')()
   result['native_pid'] = getattr(module, '___syscall_getpid')()
   try:
    descriptor = __import__('os').open('/export-replacement-absent', 0)
   except FileNotFoundError:
    result['native_after_export_replacement'] = 'FileNotFoundError'
   else:
    __import__('os').close(descriptor)
    result['native_after_export_replacement'] = 'opened'
  finally:
   setattr(module, '___syscall_openat', original_open)
  imported_open = module.resolveGlobalSymbol('__syscall_openat').sym
  assert imported_open is not None
  module.mergeLibSymbols(to_js({'__syscall_openat':getattr(module, '___syscall_getpid')}, dict_converter=Object.fromEntries), 'native-route-probe')
  result['linker_preserves_existing_syscall'] = getattr(Object, 'is')(imported_open, module.resolveGlobalSymbol('__syscall_openat').sym)
  response = await self.env.FS.fetch('https://canonical/work/local_module.py')
  result['canonical_rpc'] = await response.text()
  try:
   with open('/work/local_module.py') as source:
    result['canonical_native'] = source.read()
  except FileNotFoundError:
   result['canonical_native_error'] = 'FileNotFoundError'
  with open('/ephemeral.bin', 'wb') as output:
   output.write(bytes([0, 255, 42]))
  with open('/ephemeral.bin', 'rb') as source:
   result['native_bytes'] = list(zlib.decompress(zlib.compress(source.read())))
  return Response(json.dumps(result), headers={'Content-Type':'application/json'})
`;

test('managed Python 314.0.6 runs native I/O and explicit canonical RPC but has no qualified canonical native mount', {timeout:90000}, async context => {
  const backend = await build({stdin:{contents:`
import { MemoryFileSystem } from './packages/safe-fs/src/fs/memory/index.ts';
const filesystem = new MemoryFileSystem();
const ready = filesystem.mkdir('/work').then(() => filesystem.writeFile('/work/local_module.py', new TextEncoder().encode('answer = 42\\n')));
export default { async fetch() { await ready; return new Response(await filesystem.readFile('/work/local_module.py')); } };
`, resolveDir:root}, bundle:true, write:false, format:'esm', platform:'browser', target:'es2022'});
  const script = `export default { async fetch(request, env) {
const child = env.LOADER.load({compatibilityDate:'2026-09-17', mainModule:'main.py',
 modules:{'main.py':{py:${JSON.stringify(python)}}}, env:{FS:env.FS}, globalOutbound:null});
return child.getEntrypoint().fetch(request);
} };`;
  const runtime = new Miniflare(convertV4MiniflareOptions({cf:false, workers:[
    {name:'application', modules:true, script, compatibilityDate:'2026-09-17', workerLoaders:{LOADER:{}}, serviceBindings:{FS:'canonical'}},
    {name:'canonical', modules:true, script:backend.outputFiles[0].text, compatibilityDate:'2026-09-17'},
  ]}));
  try {
    const started = performance.now();
    const response = await runtime.dispatchFetch('http://fixture/managed');
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const result = JSON.parse(text);
    assert.equal(result.pyodide, '314.0.6');
    assert.equal(result.syscall_syncify, true);
    assert.equal(result.exposed_imports, false);
    assert.ok(result.native_hooks.includes('_syscall_syncify'));
    assert.ok(result.filesystem_backends.includes('MEMFS'));
    assert.equal(result.replaced_export_result, result.native_pid);
    assert.equal(result.native_after_export_replacement, 'FileNotFoundError');
    assert.equal(result.linker_preserves_existing_syscall, true);
    assert.equal(result.canonical_rpc, 'answer = 42\n');
    assert.deepEqual(result.native_bytes, [0, 255, 42]);
    assert.equal(result.canonical_native_error, 'FileNotFoundError');
    assert.equal(result.canonical_native, undefined);
    context.diagnostic(JSON.stringify({elapsedMs:performance.now()-started, result,
      qualification:'managed ABI and RPC characterization only; canonical native mount remains unqualified'}));
  } finally { await runtime.dispose(); }
});

test('managed Python static Wasm import and env serialization characterization', {timeout:30000}, async context => {
  const pythonEntry = `from workers import WorkerEntrypoint, Response, import_from_javascript
from js import WebAssembly
class Default(WorkerEntrypoint):
 async def fetch(self, request):
  bridge = import_from_javascript('bridge.wasm')
  instance = WebAssembly.Instance.new(getattr(bridge, 'default'))
  return Response(str(instance.exports.answer()))
`;
  const script = `import bridge from 'bridge.wasm';
export default { async fetch(request, env) {
 const mode = new URL(request.url).pathname;
 const code = {compatibilityDate:'2026-09-17', mainModule:'main.py',
  modules:{'main.py':{py:${JSON.stringify(pythonEntry)}}}, env:{}, globalOutbound:null};
 if (mode === '/javascript') {
  code.mainModule = 'main.js';
  code.modules = {'main.js':{js:"import bridge from 'bridge.wasm'; export default {fetch() { return new Response(String(new WebAssembly.Instance(bridge).exports.answer())); }}"}};
 }
 if (mode === '/binding') code.env.BRIDGE = bridge;
 else code.modules['bridge.wasm'] = {wasm:new Uint8Array(${JSON.stringify(Array.from(answerWasm))}).buffer};
 try { return await env.LOADER.load(code).getEntrypoint().fetch(request); }
 catch (error) { return Response.json({error:String(error)}, {status:422}); }
}};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({cf:false, compatibilityDate:'2026-09-17',
    modules:[{type:'ESModule',path:resolve(process.env.TMPDIR,'managed-boundary.mjs'),contents:script},
      {type:'CompiledWasm',path:resolve(process.env.TMPDIR,'bridge.wasm'),contents:answerWasm}], workerLoaders:{LOADER:{}}}));
  try {
    const control = await runtime.dispatchFetch('http://fixture/javascript');
    assert.equal(control.status, 200);
    assert.equal(await control.text(), '42');
    for (const route of ['module', 'binding']) {
      const response = await runtime.dispatchFetch('http://fixture/' + route);
      const text = await response.text();
      context.diagnostic(JSON.stringify({route,status:response.status,text}));
      assert.equal(response.status, route === 'module' ? 200 : 422, text);
      if (route === 'module') assert.equal(text, '42');
      else assert.ok(JSON.parse(text).error.includes('Unable to deserialize cloned data'));
    }
  } finally { await runtime.dispose(); }
});

test('managed Python native C-API callable awaits canonical bytes through a static Wasm import', {timeout:20000}, async context => {
  const nativePython = `
import asyncio, json, struct, sys, pyodide_js
from js import WebAssembly, Object, Promise, Reflect, Response as JsResponse
from pyodide.ffi import to_js
from workers import WorkerEntrypoint, Response, import_from_javascript
class Default(WorkerEntrypoint):
 async def fetch(self, request):
  module = pyodide_js._module
  encode = lambda value: to_js(value, dict_converter=Object.fromEntries)
  table = WebAssembly.Table.new(encode({'element':'anyfunc','initial':1}))
  table.set(0, module._syscall_syncify)
  active = WebAssembly.Global.new(encode({'value':'i32','mutable':True}), 1)
  ticks = []
  async def tick():
   await asyncio.sleep(0.001)
   ticks.append(1)
  fetch_module = import_from_javascript('fetch-bridge.wasm')
  binding = import_from_javascript('cloudflare:workers').env.FS
  then = Reflect.get(Promise.prototype, 'then')
  dispatch = WebAssembly.Instance.new(getattr(fetch_module, 'default'), encode({'host':{
   'utf8':module.UTF8ToString,'fetch':binding.fetch.bind(binding),
   'then':then.call.bind(then),
   'text':WebAssembly.Global.new(encode({'value':'externref'}), JsResponse.prototype.text.call.bind(JsResponse.prototype.text)),
   'allocate':WebAssembly.Global.new(encode({'value':'externref'}), module.stringToNewUTF8)}}))
  bridge = import_from_javascript('native-call.wasm')
  instance = WebAssembly.Instance.new(getattr(bridge, 'default'), encode({
   'python':{'utf8':module._PyUnicode_AsUTF8,'unicode':module._PyUnicode_FromString,
    'free':module._free,'noMemory':module._PyErr_NoMemory},
   'request':{'send':dispatch.exports.send},'shutdown':{'send':module._PyErr_NoMemory.bind(module)},
   'control':{'active':active,'syncify':table}}))
  function = module.addFunction(instance.exports.call, 'iii')
  definition = module._malloc(128)
  module.HEAPU8.fill(0, definition, definition + 128)
  module.HEAPU8.set(encode(list(b'request\\0_safe_managed_probe\\0')), definition + 16)
  module.HEAPU8.set(encode(list(struct.pack('<IIII', definition + 16, function, 8, 0))), definition)
  extension = module._PyImport_AddModule(definition + 24)
  callable = module._PyCFunction_NewEx(definition, 0, 0)
  assert module._PyModule_AddObject(extension, definition + 16, callable) == 0
  from _safe_managed_probe import request as native_request
  ticker = asyncio.create_task(tick())
  try:
   result = native_request('https://canonical/work/local_module.py')
   return Response(json.dumps({'result':result,'ticks':len(ticks)}), headers={'Content-Type':'application/json'})
  finally:
   ticker.cancel()
   await asyncio.gather(ticker, return_exceptions=True)
   del native_request
   del sys.modules['_safe_managed_probe'].request
   del sys.modules['_safe_managed_probe']
   module.removeFunction(function)
   module._free(definition)
`;
  const backend = await build({stdin:{contents:`
import { MemoryFileSystem } from './packages/safe-fs/src/fs/memory/index.ts';
const filesystem = new MemoryFileSystem();
const calls = [];
const ready = filesystem.mkdir('/work').then(() => filesystem.writeFile('/work/local_module.py', new TextEncoder().encode('answer = 42\\n')));
export default { async fetch(request) { await ready; const path = new URL(request.url).pathname;
 if (path === '/audit') return Response.json(calls);
 calls.push(path); await new Promise(resolve => setTimeout(resolve, 5)); return new Response(await filesystem.readFile(path)); } };
`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const script = `export default { async fetch(request, env) {
const code = {compatibilityDate:'2026-09-17',mainModule:'main.py',modules:{
 'main.py':{py:${JSON.stringify(nativePython)}},
 'native-call.wasm':{wasm:new Uint8Array(${JSON.stringify(Array.from(createPythonJspiNativeCall()))}).buffer},
 'fetch-bridge.wasm':{wasm:new Uint8Array(${JSON.stringify(Array.from(fetchBridge))}).buffer}},
 env:{FS:env.FS},globalOutbound:null};
const response = await env.LOADER.load(code).getEntrypoint().fetch(request);
if (response.status !== 200) return response;
return Response.json({...await response.json(), calls:await (await env.FS.fetch('https://canonical/audit')).json()});
}};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({cf:false,workers:[
    {name:'native-application',modules:true,script,compatibilityDate:'2026-09-17',workerLoaders:{LOADER:{}},serviceBindings:{FS:'canonical'}},
    {name:'canonical',modules:true,script:backend.outputFiles[0].text,compatibilityDate:'2026-09-17'},
  ]}));
  try {
    const response = await runtime.dispatchFetch('http://fixture/native-extension');
    const text = await response.text();
    context.diagnostic(text);
    assert.equal(response.status, 200, text);
    const result = JSON.parse(text);
    assert.equal(result.result, 'answer = 42\n');
    assert.deepEqual(result.calls, ['/work/local_module.py']);
    assert.ok(result.ticks > 0);
  } finally { await runtime.dispose(); }
});
