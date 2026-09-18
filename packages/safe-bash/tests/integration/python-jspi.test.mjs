import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult } from '../../src/commands/python/jspi-trampoline.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const tooling = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
assert.ok(tooling, 'Set SAFE_BASH_CF_RUNTIME_ROOT to Miniflare 5.20260917.0-alpha / workerd 1.20260917.1');
assert.ok(process.env.TMPDIR?.startsWith(resolve(root, 'out') + '/'), 'Set TMPDIR to an existing directory under worktree out/');
const require = createRequire(resolve(tooling, 'package.json'));
assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
assert.equal(require('workerd/package.json').version, '1.20260917.1');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const runtimeRoot = fileURLToPath(new URL('./pyodide-runtime/node_modules/pyodide/', import.meta.url));
const manifest = {
  'pyodide.mjs': [17931, '69e3f6ccec3e14b465df60be577ca62f536251406b9a00cce019eac5252a2495'],
  'pyodide.asm.mjs': [1250344, '2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7'],
  'pyodide.asm.wasm': [9598218, '3a0a00dfeaa348ac20f9ef09904233d32d33f644339662d4af368f8a2010f37a'],
  'python_stdlib.zip': [2545564, '80c5be6babfe03297069703410c3c29404dcf2525d2b128746bae5536f94831f'],
  'pyodide-lock.json': [114440, '3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4'],
};
const files = {};
for (const [name, [size, digest]] of Object.entries(manifest)) {
  const path = resolve(runtimeRoot, name);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, size);
  const bytes = readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  files[name] = bytes;
}

function embeddedModule(source, select) {
  const ast = ts.createSourceFile('pinned.mjs', source.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const selected = [];
  function visit(node) { const value = select(node); if (value) selected.push(value); ts.forEachChild(node, visit); }
  visit(ast);
  assert.equal(selected.length, 1, 'Pinned loader helper ABI changed');
  return selected[0];
}
const helper = embeddedModule(files['pyodide.mjs'], node => ts.isVariableDeclaration(node) && node.name.getText() === 'G'
  && ts.isCallExpression(node.initializer) && ts.isStringLiteral(node.initializer.arguments[0])
  ? Buffer.from(node.initializer.arguments[0].text, 'base64') : undefined);
const ccall = embeddedModule(files['pyodide.asm.mjs'], node => ts.isFunctionDeclaration(node) && node.name?.text === 'getWasmTrampolineModule'
  ? Buffer.from(node.body.statements[0].expression.arguments[0].arguments[0].text, 'hex') : undefined);
const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

test('real workerd native async I/O, imports, binary streams and asynchronous finalization', { timeout: 30000 }, async context => {
  const injection = `
import main from 'main.wasm';
import helper from 'helper.wasm';
import ccall from 'ccall.wasm';
import empty from 'empty.wasm';
import stdlib from 'stdlib.bin';
import { createPythonJspiAssets } from ${JSON.stringify(resolve(root, 'packages/safe-bash/src/commands/python/jspi-assets.ts'))};
const assets = createPythonJspiAssets({ main, stdlib:new Uint8Array(stdlib), modules:[
 { module:helper,bytes:new Uint8Array(${JSON.stringify(Array.from(helper))}) },
 { module:ccall,bytes:new Uint8Array(${JSON.stringify(Array.from(ccall))}) },
 { module:empty,bytes:new Uint8Array(${JSON.stringify(Array.from(empty))}) },
]});
const { WebAssembly, fetch, location } = assets;
export { WebAssembly, fetch, location };
`;
  const outputRoot = process.env.TMPDIR;
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./python-jspi.worker.mjs', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', conditions: ['workerd', 'browser'],
    external: ['main.wasm', 'helper.wasm', 'ccall.wasm', 'empty.wasm', 'trampoline.wasm', 'native-call.wasm', 'stat-result.wasm', 'stdlib.bin', 'node:*', 'ws'],
    define: { 'globalThis.process': 'undefined', process: 'undefined' },
    alias: { 'pinned-pyodide-loader': resolve(runtimeRoot, 'pyodide.mjs'),
      'pinned-pyodide-module': resolve(runtimeRoot, 'pyodide.asm.mjs'),
      'pinned-pyodide-lock': resolve(runtimeRoot, 'pyodide-lock.json'),
      '@poe-code/safe-fs/core': resolve(root, 'packages/safe-fs/src/core.ts') },
    inject: ['python-static-assets'], plugins: [{ name: 'python-static-assets', setup(plugin) {
      plugin.onResolve({ filter: /^python-static-assets$/ }, () => ({ path: 'assets', namespace: 'python-static-assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'python-static-assets' }, () => ({ contents: injection, loader: 'js', resolveDir: root }));
    } }] });
  const modules = [
    { type: 'ESModule', path: resolve(outputRoot, 'main.mjs'), contents: bundle.outputFiles[0].text },
    ...[['main.wasm', files['pyodide.asm.wasm']], ['helper.wasm', helper], ['ccall.wasm', ccall],
      ['empty.wasm', empty], ['trampoline.wasm', createPythonJspiTrampoline()], ['native-call.wasm', createPythonJspiNativeCall()],
      ['stat-result.wasm', createPythonJspiStatResult()]].map(([name, contents]) => ({ type: 'CompiledWasm', path: resolve(outputRoot, name), contents })),
    { type: 'Data', path: resolve(outputRoot, 'stdlib.bin'), contents: files['python_stdlib.zip'] },
  ];
  const miniflare = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-09-17', cf: false }));
  try {
    const response = await miniflare.dispatchFetch('http://fixture/native');
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(result.stdout, [0, 255, 42]);
    assert.deepEqual(result.stderr, [255, 0]);
    assert.deepEqual(result.output, [0, 255, 42]);
    assert.deepEqual(result.failures, []);
    assert.equal(result.maximumRequests, 1);
    assert.ok(result.ticks > 0);
    assert.ok(result.requests.some(request => request.op === 'open' && request.path === '/work/local_module.py'));
    assert.ok(result.requests.some(request => request.op === 'stdin'));
    const finalizationResponse = await miniflare.dispatchFetch('http://fixture/finalization');
    const finalization = await finalizationResponse.json();
    assert.equal(finalizationResponse.status, 200, JSON.stringify(finalization));
    assert.deepEqual(finalization.failures, []);
    assert.deepEqual(finalization.finalized, [42]);
    assert.deepEqual(finalization.buffered, [255, 0, 43]);
    assert.deepEqual(finalization.destructor, [44]);
    assert.deepEqual(finalization.stdout, [0, 255, 42, 45]);
    context.diagnostic(JSON.stringify({ sourceQualificationOnly: true, memory: result.memory, elapsedMs: result.elapsedMs,
      requests: result.requests.length, finalizationFailure: finalization.failures,
      assets: modules.map(module => ({ name: module.path.slice(outputRoot.length + 1), bytes: Buffer.byteLength(module.contents) })) }));
  } finally { await miniflare.dispose(); }
});
