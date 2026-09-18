import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const tooling = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
assert.ok(tooling, 'Set SAFE_BASH_CF_RUNTIME_ROOT to the pinned workerd tooling');
assert.ok(process.env.TMPDIR?.startsWith(resolve(root, 'out') + '/'));
const require = createRequire(resolve(tooling, 'package.json'));
assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
assert.equal(require('workerd/package.json').version, '1.20260917.1');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const python = `
import json, sys, pyodide, pyodide_js, zlib
from workers import WorkerEntrypoint, Response
class Default(WorkerEntrypoint):
 async def fetch(self, request):
  result = {'python': sys.version.split()[0], 'pyodide': pyodide.__version__,
   'syscall_syncify': hasattr(pyodide_js._module, '_syscall_syncify'),
   'exposed_imports': hasattr(pyodide_js._module, 'wasmImports')}
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
    assert.equal(result.canonical_rpc, 'answer = 42\n');
    assert.deepEqual(result.native_bytes, [0, 255, 42]);
    assert.equal(result.canonical_native_error, 'FileNotFoundError');
    assert.equal(result.canonical_native, undefined);
    context.diagnostic(JSON.stringify({elapsedMs:performance.now()-started, result,
      qualification:'managed ABI and RPC characterization only; canonical native mount remains unqualified'}));
  } finally { await runtime.dispose(); }
});
