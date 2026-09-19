import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { createPythonJspiCallbackCatalog } from './python-jspi-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const consumerRoot = process.env.SAFE_BASH_PYTHON_CONSUMER_ROOT;
const assetDirectory = process.env.SAFE_BASH_PYTHON_ASSET_DIR;
if (assetDirectory) {
  assert.ok(consumerRoot, 'Deployable qualification assets require installed public packages');
  assert.ok(resolve(assetDirectory).startsWith(resolve(root, 'out') + '/'), 'Write qualification assets only under worktree out/');
}
const consumerPackage = consumerRoot && resolve(consumerRoot, 'node_modules/@poe-platform/safe-bash');
const pythonEntry = consumerRoot
  ? resolve(consumerPackage, JSON.parse(readFileSync(resolve(consumerPackage, 'package.json'), 'utf8')).exports['./commands/python'].import)
  : resolve(root, 'packages/safe-bash/src/commands/python/jspi-trampoline.ts');
const { createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult } = await import(pathToFileURL(pythonEntry).href);
if (consumerRoot) {
  assert.ok(resolve(consumerRoot).startsWith(resolve(root, 'out') + '/'));
  for (const name of ['safe-bash', 'safe-fs', 'safe-js']) {
    assert.equal(lstatSync(resolve(consumerRoot, 'node_modules/@poe-platform', name)).isSymbolicLink(), false);
  }
}
const tooling = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
assert.ok(tooling, 'Set SAFE_BASH_CF_RUNTIME_ROOT to Miniflare 5.20260917.0-alpha / workerd 1.20260917.1');
assert.ok(process.env.TMPDIR?.startsWith(resolve(root, 'out') + '/'), 'Set TMPDIR to an existing directory under worktree out/');
const require = createRequire(resolve(tooling, 'package.json'));
assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
assert.equal(require('workerd/package.json').version, '1.20260917.1');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const runtimeRoot = process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT
  ?? fileURLToPath(new URL('./pyodide-runtime/node_modules/pyodide/', import.meta.url));
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
const callbacks = createPythonJspiCallbackCatalog(files['pyodide.asm.mjs']);
const callbackFiles = callbacks.map(({signature}) => 'callback-' + signature + '.wasm');

test('real workerd native async I/O, imports, binary streams and asynchronous finalization', { timeout: 30000 }, async context => {
  const injection = `
import main from 'main.wasm';
import helper from 'helper.wasm';
import ccall from 'ccall.wasm';
import empty from 'empty.wasm';
${callbackFiles.map((name, index) => `import callback${index} from '${name}';`).join('\n')}
import stdlib from 'stdlib.bin';
import { createPythonJspiAssets } from '@poe-platform/safe-bash/commands/python';
const assets = createPythonJspiAssets({ main, stdlib:new Uint8Array(stdlib), modules:[
 { module:helper,bytes:new Uint8Array(${JSON.stringify(Array.from(helper))}) },
 { module:ccall,bytes:new Uint8Array(${JSON.stringify(Array.from(ccall))}) },
 { module:empty,bytes:new Uint8Array(${JSON.stringify(Array.from(empty))}) },
${callbacks.map(({bytes}, index) => ` { module:callback${index},bytes:new Uint8Array(${JSON.stringify(Array.from(bytes))}) },`).join('\n')}
]});
const { WebAssembly, fetch, location } = assets;
export { WebAssembly, fetch, location };
`;
  const outputRoot = process.env.TMPDIR;
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./python-jspi.worker.mjs', import.meta.url))],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'es2022', conditions: ['workerd', 'browser'],
    external: ['main.wasm', 'helper.wasm', 'ccall.wasm', 'empty.wasm', 'trampoline.wasm', 'native-call.wasm', 'stat-result.wasm', 'stdlib.bin', 'node:*', 'ws', ...callbackFiles],
    define: { 'globalThis.process': 'undefined', process: 'undefined' },
    alias: { 'pinned-pyodide-loader': resolve(runtimeRoot, 'pyodide.mjs'),
      'pinned-pyodide-module': resolve(runtimeRoot, 'pyodide.asm.mjs'),
      'pinned-pyodide-lock': resolve(runtimeRoot, 'pyodide-lock.json'),
      ...(consumerRoot ? {} : {
        '@poe-code/safe-fs/core': resolve(root, 'packages/safe-fs/src/core.ts'),
        '@poe-platform/safe-fs/core': resolve(root, 'packages/safe-fs/src/core.ts'),
        '@poe-platform/safe-bash/commands/python': resolve(root, 'packages/safe-bash/src/commands/python/index.ts'),
        '@poe-platform/safe-bash': resolve(root, 'packages/safe-bash/src/shell/shell.ts'),
        'safe-bash-contracts': resolve(root, 'packages/safe-bash-contracts/src'),
      }) },
    inject: ['python-static-assets'], plugins: [{ name: 'python-static-assets', setup(plugin) {
      if (consumerRoot) plugin.onResolve({ filter: /^@poe-platform\// }, args => {
        if (args.pluginData?.consumer) return;
        return plugin.resolve(args.path, {resolveDir:consumerRoot, kind:'import-statement', pluginData:{consumer:true}});
      });
      plugin.onResolve({ filter: /^python-static-assets$/ }, () => ({ path: 'assets', namespace: 'python-static-assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'python-static-assets' }, () => ({ contents: injection, loader: 'js', resolveDir: root }));
    } }] });
  if (consumerRoot) {
    const inputs = Object.keys(bundle.metafile.inputs).map(path => resolve(root, path));
    assert.equal(inputs.some(path => path.startsWith(resolve(root, 'packages/safe-bash/src') + '/')), false);
    assert.equal(inputs.some(path => path.startsWith(resolve(root, 'packages/safe-fs/src') + '/')), false);
    assert.ok(inputs.some(path => path.startsWith(resolve(consumerRoot, 'node_modules/@poe-platform/safe-bash') + '/')));
    assert.ok(inputs.some(path => path.startsWith(resolve(consumerRoot, 'node_modules/@poe-platform/safe-fs') + '/')));
  } else {
    for (const input of Object.keys(bundle.metafile.inputs)) {
      const path = resolve(root, input);
      if (path.includes('/packages/')) {
        assert.ok(path.startsWith(root + '/'), 'Qualification must use candidate sources: ' + path);
      }
    }
  }
  const modules = [
    { type: 'ESModule', path: resolve(outputRoot, 'main.mjs'), contents: bundle.outputFiles[0].text },
    ...[['main.wasm', files['pyodide.asm.wasm']], ['helper.wasm', helper], ['ccall.wasm', ccall],
      ['empty.wasm', empty], ['trampoline.wasm', createPythonJspiTrampoline()], ['native-call.wasm', createPythonJspiNativeCall()],
      ['stat-result.wasm', createPythonJspiStatResult()]].map(([name, contents]) => ({ type: 'CompiledWasm', path: resolve(outputRoot, name), contents })),
    ...callbacks.map(({bytes}, index) => ({ type:'CompiledWasm', path:resolve(outputRoot, callbackFiles[index]), contents:bytes })),
    { type: 'Data', path: resolve(outputRoot, 'stdlib.bin'), contents: files['python_stdlib.zip'] },
  ];
  const runtimeErrors = [];
  const miniflare = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-09-17', cf: false,
    handleStructuredLogs(entry) {
      if (entry.level === 'error') runtimeErrors.push(entry);
      context.diagnostic(JSON.stringify({workerd:entry}));
    },
    handleUncaughtError(error) { runtimeErrors.push({uncaught:String(error)}); },
  }));
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
    const backgroundResponse = await miniflare.dispatchFetch('http://fixture/background');
    const background = await backgroundResponse.json();
    assert.equal(backgroundResponse.status, 200, JSON.stringify(background));
    assert.deepEqual(background.callbacks, []);
    assert.deepEqual(background.failures, []);
    const tasksResponse = await miniflare.dispatchFetch('http://fixture/tasks');
    const tasks = await tasksResponse.json();
    assert.equal(tasksResponse.status, 200, JSON.stringify(tasks));
    assert.equal(tasks.exitCode, 0, JSON.stringify(tasks));
    assert.deepEqual(tasks.failures, []);
    assert.deepEqual(tasks.taskFinalized, [46]);
    assert.deepEqual(tasks.generatorFinalized, [47]);
    const cancelledResponse = await miniflare.dispatchFetch('http://fixture/cancel');
    const cancelled = await cancelledResponse.json();
    assert.equal(cancelledResponse.status, 200, JSON.stringify(cancelled));
    assert.deepEqual(cancelled.finalizations, ['atexit']);
    assert.deepEqual(cancelled.failures, []);
    const startupResponse = await miniflare.dispatchFetch('http://fixture/startup-cancel');
    const startup = await startupResponse.json();
    assert.equal(startupResponse.status, 200, JSON.stringify(startup));
    assert.deepEqual(startup.finalizations, ['atexit']);
    assert.deepEqual(startup.failures, []);
    const shellResponse = await miniflare.dispatchFetch('http://fixture/shell');
    const shell = await shellResponse.json();
    assert.equal(shellResponse.status, 200, JSON.stringify(shell));
    assert.equal(shell.waitedForRead, true);
    assert.equal(shell.firstError, 'Error: Shell is disposed', JSON.stringify(shell));
    assert.deepEqual(shell.borrowed, {active:1, capacity:2, closed:false});
    assert.equal(shell.siblingExit, 0, JSON.stringify(shell));
    assert.deepEqual(shell.siblingBytes, [255, 0, 49]);
    assert.equal(shell.freshExit, 0);
    assert.equal(shell.fresh, 'fresh\n');
    assert.deepEqual(shell.closed, ['first', 'sibling']);
    assert.equal(shell.acquisitions, 3);
    assert.deepEqual(shell.failures, []);
    assert.deepEqual(shell.finalizations, ['atexit']);
    const proxyResponse = await miniflare.dispatchFetch('http://fixture/proxy');
    const proxy = await proxyResponse.json();
    assert.equal(proxyResponse.status, 200, JSON.stringify(proxy));
    assert.deepEqual(proxy.failures, []);
    const errorResponse = await miniflare.dispatchFetch('http://fixture/unhandled-errors');
    assert.equal(errorResponse.status, 200);
    assert.deepEqual(await errorResponse.json(), [], 'Actual workerd qualification must have zero unhandled Worker errors');
    assert.deepEqual(runtimeErrors, [], 'Actual workerd qualification must have zero runtime errors');
    if (assetDirectory) {
      await mkdir(assetDirectory, {recursive:false});
      const assets = [];
      for (const module of modules) {
        const name = module.path.slice(outputRoot.length + 1);
        const bytes = Buffer.from(module.contents);
        await writeFile(resolve(assetDirectory, name), bytes, {flag:'wx'});
        assets.push({name, type:module.type, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});
      }
      await writeFile(resolve(assetDirectory, 'manifest.json'), JSON.stringify({
        packageVersion:JSON.parse(readFileSync(resolve(consumerPackage, 'package.json'), 'utf8')).version,
        mainModule:'main.mjs', compatibilityDate:'2026-09-17', compatibilityFlags:[],
        miniflare:require('miniflare/package.json').version, workerd:require('workerd/package.json').version,
        pyodide:'314.0.6', pinnedInputs:manifest, assets,
        callbackSignatures:callbacks.map(({signature}) => signature), unhandledWorkerErrors:[],
        qualification:'local installed-public-package workerd only; no deployment claim',
      }, null, 2) + '\n', {flag:'wx'});
    }
    context.diagnostic(JSON.stringify({ artifact: consumerRoot ? 'installed-public-packages' : 'workspace-source', memory: result.memory, elapsedMs: result.elapsedMs,
      requests: result.requests.length, finalizationFailure: finalization.failures, callbackModules:callbacks.length, unhandledWorkerErrors:[],
      assets: modules.map(module => ({ name: module.path.slice(outputRoot.length + 1), bytes: Buffer.byteLength(module.contents) })) }));
  } finally {
    await miniflare.dispose();
    assert.deepEqual(runtimeErrors, [], 'Actual workerd qualification must have zero unhandled/runtime errors');
  }
});

test('actual workerd error gate rejects an unhandled initialization rejection despite successful buffered output', { timeout: 10000 }, async () => {
  const bundle = await build({ stdin:{contents:`
import { observePythonJspiUnhandledErrors } from './python-jspi-errors.mjs';
const errors = observePythonJspiUnhandledErrors(globalThis);
export default { async fetch(request) {
 if (new URL(request.url).pathname === '/unhandled-errors') {
  await new Promise(resolve => setTimeout(resolve, 0));
  return Response.json(errors.snapshot());
 }
 Promise.reject(new WebAssembly.CompileError('python-jspi-error-gate-negative-control'));
 await new Promise(resolve => setTimeout(resolve, 0));
 return Response.json({exitCode:0, stdout:'production-python-assertions-pass'});
} };
`, resolveDir:dirname(fileURLToPath(import.meta.url)), loader:'js' }, bundle:true, write:false, format:'esm', platform:'browser' });
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: [{ type:'ESModule', path:resolve(process.env.TMPDIR, 'error-gate.mjs'), contents:bundle.outputFiles[0].text }],
    compatibilityDate:'2026-09-17', cf:false,
  }));
  try {
    const response = await miniflare.dispatchFetch('http://fixture/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {exitCode:0, stdout:'production-python-assertions-pass'});
    const errorResponse = await miniflare.dispatchFetch('http://fixture/unhandled-errors');
    assert.equal(errorResponse.status, 200);
    const errors = await errorResponse.json();
    assert.throws(() => assert.deepEqual(errors, [], 'Actual workerd qualification must have zero unhandled Worker errors'), assert.AssertionError);
    assert.deepEqual(errors, [{type:'unhandledrejection', reason:'CompileError: python-jspi-error-gate-negative-control'}]);
  } finally {
    await miniflare.dispose();
  }
});
