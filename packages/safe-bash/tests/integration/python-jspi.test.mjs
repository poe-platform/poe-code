import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

import packageCommandReference from '../../../safe-bash-command-llm/src/fixtures/package-commands-0.27.1.json' with {type:'json'};
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
const dependencyRoot = process.env.SAFE_BASH_PYTHON_LLM_DEPENDENCIES_ROOT;
assert.ok(dependencyRoot, 'Set SAFE_BASH_PYTHON_LLM_DEPENDENCIES_ROOT to the authenticated offline LLM dependency bundle');
const { pythonLlmDependencies } = await import(pathToFileURL(consumerRoot ? pythonEntry : resolve(root, 'packages/safe-bash/src/commands/python/llm-dependencies.ts')).href);
const dependencyArchives = dependencyRoot ? pythonLlmDependencies.archives.map((archive, index) => {
  const bytes = readFileSync(resolve(dependencyRoot, archive.fileName));
  assert.equal(bytes.length, archive.byteLength);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), archive.sha256);
  return {...archive, bytes, asset:'python-dependency-' + index + '.bin'};
}) : [];
const dependencyNative = dependencyRoot ? pythonLlmDependencies.nativeModules.map((native, index) => {
  const bytes = readFileSync(resolve(dependencyRoot, native.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), native.sha256);
  return {bytes, wasm:'python-native-' + index + '.wasm', data:'python-native-' + index + '.bin'};
}) : [];


const {readPythonLlmAssets} = await import(pathToFileURL(consumerRoot
  ? resolve(consumerPackage, JSON.parse(readFileSync(resolve(consumerPackage, 'package.json'), 'utf8')).exports['./commands/python/node'].import)
  : resolve(root, 'packages/safe-bash/src/commands/python/llm-assets-node.ts')).href);
const llmDirectory = process.env.SAFE_BASH_LLM_PACKAGE_DIR;
assert.ok(llmDirectory, 'Set SAFE_BASH_LLM_PACKAGE_DIR to the explicitly provisioned pinned LLM wheels');
const llmAssets = await readPythonLlmAssets(llmDirectory);
const llmWheels = llmAssets.packages.map(asset=>({distribution:{file:asset.file},contents:asset.bytes}));
const llmNative = llmAssets.modules.map(asset=>asset.bytes);
const llmWheelNames = llmWheels.map((_, index) => 'llm-wheel-' + index + '.bin');
const llmNativeNames = llmNative.map((_, index) => 'llm-native-' + index + '.wasm');
const llmNativeBytesNames = llmNative.map((_, index) => 'llm-native-' + index + '.bin');

async function createNativeFixture(context) {
  const injection = `
import main from 'main.wasm';
${dependencyArchives.map((archive, index) => `import dependency${index} from '${archive.asset}';`).join('\n')}
${dependencyNative.map((native, index) => `import native${index} from '${native.wasm}'; import nativeBytes${index} from '${native.data}';`).join('\n')}

import helper from 'helper.wasm';
import ccall from 'ccall.wasm';
import empty from 'empty.wasm';
${callbackFiles.map((name, index) => `import callback${index} from '${name}';`).join('\n')}
import stdlib from 'stdlib.bin';
${llmNativeNames.map((name, index) => `import llmNative${index} from '${name}';`).join('\n')}
${llmNativeBytesNames.map((name, index) => `import llmNativeBytes${index} from '${name}';`).join('\n')}
${llmWheelNames.map((name, index) => `import llmWheel${index} from '${name}';`).join('\n')}
export const llmPackageAssets = [${llmWheels.map(({distribution}, index) => `{file:${JSON.stringify(distribution.file)},bytes:new Uint8Array(llmWheel${index})}`).join(',')}];
import { createPythonJspiAssets, installPythonLlmDependencies } from '@poe-platform/safe-bash/commands/python';
const assets = createPythonJspiAssets({ main, stdlib:new Uint8Array(stdlib), modules:[
${llmNativeNames.map((name, index) => ` {module:llmNative${index},bytes:new Uint8Array(llmNativeBytes${index})},`).join('\n')}
${dependencyNative.map((_, index) => ` {module:native${index},bytes:new Uint8Array(nativeBytes${index})},`).join('\n')}
 { module:helper,bytes:new Uint8Array(${JSON.stringify(Array.from(helper))}) },
 { module:ccall,bytes:new Uint8Array(${JSON.stringify(Array.from(ccall))}) },
 { module:empty,bytes:new Uint8Array(${JSON.stringify(Array.from(empty))}) },
${callbacks.map(({bytes}, index) => ` { module:callback${index},bytes:new Uint8Array(${JSON.stringify(Array.from(bytes))}) },`).join('\n')}
]});
const { WebAssembly, fetch, location } = assets;
export { WebAssembly, fetch, location };
export async function installStaticPackages(runtime) {
 ${dependencyRoot ? `await installPythonLlmDependencies(runtime,[${dependencyArchives.map((archive,index) => `{fileName:${JSON.stringify(archive.fileName)},bytes:new Uint8Array(dependency${index})}`).join(',')}]);` : ''}
}

`;
  const outputRoot = process.env.TMPDIR;
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./python-jspi.worker.mjs', import.meta.url))],
    outfile:resolve(outputRoot, 'main.mjs'), loader:{'.wasm':'copy'},
    bundle: true, write: false, metafile: true, platform: 'browser', mainFields: ['browser', 'module', 'main'], format: 'esm', target: 'es2022', conditions: ['workerd', 'browser'],
    external: [...dependencyArchives.map(archive => archive.asset), ...dependencyNative.flatMap(native => [native.wasm,native.data]), 'main.wasm', 'helper.wasm', 'ccall.wasm', 'empty.wasm', 'trampoline.wasm', 'native-call.wasm', 'stat-result.wasm', 'stdlib.bin', 'node:*', 'ws', ...callbackFiles, ...llmWheelNames, ...llmNativeNames, ...llmNativeBytesNames],
    define: { 'globalThis.process': 'undefined', process: 'undefined' },
    alias: { 'pinned-pyodide-loader': resolve(runtimeRoot, 'pyodide.mjs'),
      'pinned-pyodide-module': resolve(runtimeRoot, 'pyodide.asm.mjs'),
      'pinned-pyodide-lock': resolve(runtimeRoot, 'pyodide-lock.json'),
      ...(consumerRoot ? {} : {
        '@poe-code/safe-fs/core': resolve(root, 'packages/safe-fs/src/core.ts'),
        '@poe-platform/safe-fs/core': resolve(root, 'packages/safe-fs/src/core.ts'),
        '@poe-platform/safe-bash/core': resolve(root, 'packages/safe-bash/src/commands/index.ts'),
        '@poe-platform/safe-bash/search': resolve(root, 'packages/safe-bash/src/search.ts'),
        '@poe-platform/safe-bash/commands/llm/collections': resolve(root, 'packages/safe-bash/src/commands/llm/collections.ts'),
        '@poe-platform/safe-bash/commands/llm': resolve(root, 'packages/safe-bash/src/commands/llm/index.ts'),
        '@poe-platform/safe-bash/commands/python': resolve(root, 'packages/safe-bash/src/commands/python/index.ts'),
        '@poe-platform/safe-bash': resolve(root, 'packages/safe-bash/src/shell/shell.ts'),
        'safe-bash-contracts': resolve(root, 'packages/safe-bash-contracts/src'),
      }) },
    inject: ['python-static-assets'], plugins: [{ name: 'python-static-assets', setup(plugin) {
      if (consumerRoot) plugin.onResolve({ filter: /^@poe-platform\// }, args => {
        if (args.pluginData?.consumer) return;
        return plugin.resolve(args.path, {resolveDir:consumerRoot, kind:'import-statement', pluginData:{consumer:true}});
      });
      plugin.onResolve({filter:/^standard-llm-program$/},()=>({path:'standard',namespace:'standard-llm-program'}));
      plugin.onLoad({filter:/.*/,namespace:'standard-llm-program'},()=>({loader:'text',contents:readFileSync(resolve(root,'packages/safe-bash/tests/integration/llm-standard.py'),'utf8')}));
      plugin.onResolve({ filter: /^python-library-examples$/ }, () => ({path:'examples', namespace:'python-library-examples'}));
      plugin.onLoad({ filter: /.*/, namespace:'python-library-examples' }, () => ({loader:'json', contents:JSON.stringify(Object.fromEntries(
        ['llm-single.py', 'llm-stream.py', 'llm-customize.py', 'shell-tools.py'].map(name => [name, readFileSync(resolve(root, 'packages/safe-bash/docs/examples', name), 'utf8')])))}));
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
    { type: 'ESModule', path: resolve(outputRoot, 'main.mjs'), contents: bundle.outputFiles.find(file => file.path.endsWith('.mjs')).text },
    ...llmWheels.map(({contents}, index) => ({type:'Data',path:resolve(outputRoot,llmWheelNames[index]),contents})),
    ...llmNative.flatMap((contents, index) => [{type:'CompiledWasm',path:resolve(outputRoot,llmNativeNames[index]),contents},{type:'Data',path:resolve(outputRoot,llmNativeBytesNames[index]),contents}]),
    ...bundle.outputFiles.filter(file => file.path.endsWith('.wasm')).map(file => ({type:'CompiledWasm', path:file.path, contents:file.contents})),
    ...[['main.wasm', files['pyodide.asm.wasm']], ['helper.wasm', helper], ['ccall.wasm', ccall],
      ['empty.wasm', empty], ['trampoline.wasm', createPythonJspiTrampoline()], ['native-call.wasm', createPythonJspiNativeCall()],
      ['stat-result.wasm', createPythonJspiStatResult()]].map(([name, contents]) => ({ type: 'CompiledWasm', path: resolve(outputRoot, name), contents })),
    ...dependencyArchives.map(archive => ({type:'Data',path:resolve(outputRoot,archive.asset),contents:archive.bytes})),
    ...dependencyNative.flatMap(native => [{type:'CompiledWasm',path:resolve(outputRoot,native.wasm),contents:native.bytes},{type:'Data',path:resolve(outputRoot,native.data),contents:native.bytes}]),
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
  return { miniflare, runtimeErrors, modules, outputRoot };
}

let nativeFixture;
before(async context => {
  nativeFixture = await createNativeFixture(context);
  await nativeFixture.miniflare.ready;
});
after(async () => {
  await nativeFixture.miniflare.dispose();
  assert.deepEqual(nativeFixture.runtimeErrors, [], 'Native qualification must drain without unhandled/runtime errors');
});

test('real workerd cancels 100 MiB close publication and recovers capacity for the next native call', { timeout: 120000 }, async () => {
  const { miniflare, runtimeErrors } = nativeFixture;
  try {
    const publicationResponse = await miniflare.dispatchFetch('http://fixture/publication-recovery');
    const publication = await publicationResponse.json();
    assert.equal(publicationResponse.status, 200, JSON.stringify(publication));
    assert.equal(publication.error, "Error: publication deadline");
    assert.equal(publication.cancelled, true);
    assert.equal(publication.publishing, false);
    assert.equal(publication.pool.active, 0);
    assert.equal(publication.size, 9 * 1024 * 1024);
    assert.equal(publication.result.exitCode, 0, JSON.stringify(publication));
    assert.equal(publication.result.stderr, '');
    const hash = createHash('sha256');
    const chunk = Uint8Array.from({length:65536}, (_, index) => index % 256);
    for (let index = 0; index < 144; index++) hash.update(chunk);
    assert.equal(publication.result.stdout, hash.digest('hex') + '\n');
    assert.deepEqual(publication.failures, []);
  } finally {
    assert.deepEqual(runtimeErrors, [], 'Native cancellation qualification must have zero unhandled/runtime errors');
  }
});

test('real workerd publishes and verifies authoritative 100 MiB bytes', { timeout: 120000 }, async () => {
  const { miniflare, runtimeErrors } = nativeFixture;
  const response = await miniflare.dispatchFetch('http://fixture/publication');
  const publication = await response.json();
  assert.equal(response.status, 200, JSON.stringify(publication));
  assert.equal(publication.cancelled, false);
  assert.equal(publication.publishing, false);
  assert.equal(publication.pool.active, 0);
  assert.equal(publication.size, 100 * 1024 * 1024);
  assert.equal(publication.result.exitCode, 0, JSON.stringify(publication));
  assert.equal(publication.result.stderr, '');
  const hash = createHash('sha256');
  const chunk = Uint8Array.from({length:65536}, (_, index) => index % 256);
  for (let index = 0; index < 1600; index++) hash.update(chunk);
  assert.equal(publication.result.stdout, hash.digest('hex') + '\n');
  assert.deepEqual(publication.failures, []);
  assert.deepEqual(runtimeErrors, []);
});

test('real workerd native async I/O, imports, binary streams and asynchronous finalization', { timeout: 120000 }, async context => {
  const { miniflare, runtimeErrors, modules, outputRoot } = nativeFixture;
  try {
    const hostResponse = await miniflare.dispatchFetch('http://fixture/host');
    const host = await hostResponse.json();
    assert.equal(hostResponse.status, 200, JSON.stringify(host));
    assert.equal(host.exitCode, 0, JSON.stringify(host));
    assert.equal(host.stdout, 'host-ok\n');
    assert.deepEqual(host.examples, [
      {name:'llm-single.py', exitCode:0, stdout:'Explain gravity in one sentence\n', stderr:''},
      {name:'llm-stream.py', exitCode:0, stdout:'Explain gravity', stderr:''},
      {name:'llm-customize.py', exitCode:0, stdout:'EXPLAIN GRAVITY\nSECOND\n', stderr:''},
      {name:'shell-tools.py', exitCode:0, stdout:'shell-example-ok\n', stderr:''},
    ]);
    assert.equal(host.stderr, '');
    assert.equal(host.released, 1);
    assert.equal(host.calls, 5);
    assert.equal(host.hostCancelled, 1);
    assert.equal(host.shellStreamCancelled, 1);
    assert.equal(host.libraryReleased, 9);
    assert.equal(host.inputSourceBytes, 16777223);
    assert.equal(host.retirementRejected, true);
    assert.equal(host.siblingExit, 0);
    assert.equal(host.sibling, 'sibling-authority\n');
    assert.ok(host.ticks > 0);
    assert.deepEqual(host.failures, []);
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

test('real workerd provides the original llm Python package', {timeout:120000}, async () => {
  const {miniflare, runtimeErrors} = nativeFixture;
  const response = await miniflare.dispatchFetch('http://fixture/llm-standard');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.exitCode, 0, new TextDecoder().decode(Uint8Array.from(result.stderr)));
  assert.equal(new TextDecoder().decode(Uint8Array.from(result.stdout.slice(3))), 'llm-reference-api\n');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(runtimeErrors, []);
});

test('real workerd preserves standard llm Python workflows', {timeout:120000}, async () => {
  const response = await nativeFixture.miniflare.dispatchFetch('http://fixture/llm-api');
  const result = await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.exitCode,0,result.stderr);
  assert.equal(result.stderr,'');
  assert.deepEqual(result.retainedInputs,[]);
  assert.equal(result.cliVersion.exitCode,0,result.cliVersion.stderr);
  assert.equal(result.cliVersion.stdout,'python -m llm, version 0.27.1\n');
  assert.deepEqual(result.configurationFiles,[], 'Model calls must not persist configuration, history or logs');
  assert.deepEqual(JSON.parse(result.stdout),{package:'0.27.1',sync:true,async:true,responses:true,conversations:true,schema:true,attachments:true,options:true,embeddings:true});
  const referencePython = process.env.SAFE_BASH_LLM_REFERENCE_PYTHON;
  assert.ok(referencePython, 'Set SAFE_BASH_LLM_REFERENCE_PYTHON to a CPython environment with pinned llm==0.27.1');
  const referenceDirectory = await mkdtemp(resolve(process.env.TMPDIR,'llm-reference-'));
  const reference = JSON.parse(execFileSync(referencePython,[
    resolve(root,'packages/safe-bash/tests/integration/llm-reference.py'),
    resolve(root,'packages/safe-bash/tests/integration/llm-standard.py'),
  ],{cwd:referenceDirectory,encoding:'utf8',timeout:30000}));
  assert.equal(result.stdout,reference.stdout);
  await rm(referenceDirectory,{recursive:true});
  assert.deepEqual(result.calls,reference.calls);
  assert.equal(result.attachmentResponses,12);
  assert.equal(result.attachmentDisposals,12);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});

test('real workerd retires standard llm inputs after cancellation', {timeout:120000}, async () => {
  const response = await nativeFixture.miniflare.dispatchFetch('http://fixture/llm-api-cancel');
  const result = await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.match(result.failure,/LLM input cancelled/);
  assert.deepEqual(result.retainedInputs,[]);
  assert.deepEqual(result.calls,[]);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});

test('real workerd confines original llm calls to platform models and credentials', {timeout:120000}, async () => {
  const response = await nativeFixture.miniflare.dispatchFetch('http://fixture/llm-policy');
  const result = await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.exitCode,0,result.stderr);
  assert.equal(result.stdout,'platform-models-only\n');
  assert.deepEqual(result.configurationFiles,[], 'Model lookup must not create configuration, history or log files');
  assert.deepEqual(result.calls,[]);
  assert.deepEqual(result.retainedInputs,[]);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd loads Python functions for LLM discovery and sync/async tool chains', {timeout:120000}, async () => {
  const response = await nativeFixture.miniflare.dispatchFetch('http://fixture/llm-functions');
  const result = await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  for (const key of ['plugins','pluginTools','missingPlugins','listing','serial','concurrent','defaultTool','toolboxListing','toolboxSerial','toolboxAsync']) assert.equal(result[key].exitCode,0,result[key].stderr);
  assert.deepEqual(JSON.parse(result.listing.stdout).tools.map(tool=>tool.name),['add','first','llm_time','llm_version','second','unicode_text']);
  for (const key of ['chat', 'freshChat', 'editedChat']) assert.equal(result[key].exitCode, 0, result[key].stderr);
  assert.equal(result.missingChatFragment.exitCode, 1);
  assert.equal(result.missingChatFragment.stdout, '');
  assert.equal(result.missingChatFragment.stderr, "Error: Fragment 'missing-fragment' not found\n");
  for (const key of ['initialStdinChatFragment', 'stdinChatFragment']) {assert.equal(result[key].exitCode, 1); assert.equal(result[key].stderr, 'Aborted!\n');}
  assert.ok(result.stdinChatFragment.stdout.endsWith('> 1\n> '), result.stdinChatFragment.stdout);
  assert.deepEqual(result.utf7Results,[{text:'A'.repeat(4095)+'a'.repeat(12288)+'\n',error:null,warnings:0},{text:'+2AA-',error:null,warnings:0},{text:'',error:'surrogates not allowed',warnings:0},{text:'',error:null,warnings:1}]);
  assert.deepEqual(result.iso2022Texts,Object.fromEntries([["iso2022_jp", "A\n\u65e5\u672c\n\u4e2d\n"], ["iso2022_jp_1", "A\n\u65e5\u672c\n\u4e2d\n"], ["iso2022_jp_2", "A\n\u65e5\u672c\n\u4e2d\n"], ["iso2022_jp_2004", "A\n\u65e5\u672c\n\u4e2d\n\ud840\udc0b\n"], ["iso2022_jp_3", "A\n\u65e5\u672c\n\u4e2d\n\ud840\udc0b\n"], ["iso2022_jp_ext", "A\n\u65e5\u672c\n\u4e2d\n\uff76\n"], ["iso2022_kr", "A\n\u65e5\u672c\n\u4e2d\n"]].map(([encoding,text])=>[encoding,'A'.repeat(4095)+text])));
  assert.equal(result.hzText, 'A'.repeat(4095)+'中\n');
  for (const key of ['missingTemplateAtPrompt','missingTemplateAtEof']) {
    assert.equal(result[key].exitCode, 1);
    assert.ok(result[key].stdout.startsWith('Chatting with fixture\n'));
    assert.ok(result[key].stdout.endsWith('> '));
  }
  assert.equal(result.missingTemplateAtPrompt.stderr, 'Error: Missing variables: missing, missing\n');
  assert.equal(result.missingTemplateAtEof.stderr, 'Aborted!\n');
  assert.equal(result.invalidChatOptions.exitCode, 1);
  assert.equal(result.invalidChatOptions.stdout, '');
  assert.equal(result.invalidChatOptions.stderr, 'Error: count\n  Input should be a valid integer, unable to parse string as an integer\n');
  for (const key of ['snapshotChatOptions','explicitChatOptions']) assert.equal(result[key].exitCode, 0, result[key].stderr);
  assert.deepEqual(result.optionCalls, [{count:9,enabled:false},{count:9,enabled:false},{count:2},{count:2}]);
  assert.equal(result.missingChatModel.exitCode, 1);
  assert.equal(result.missingChatModel.stdout, '');
  assert.equal(result.missingChatModel.stderr, "Error: 'missing' is not a known model\n");
  assert.equal(result.chatSuggestion.exitCode, 2);
  assert.equal(result.chatSuggestion.stderr, "Usage: llm chat [OPTIONS]\nTry 'llm chat -h' for help.\n\nError: No such option: --modle (Possible options: --model, --tool)\n");
  assert.equal(result.eagerChatHelp.exitCode, 0, result.eagerChatHelp.stderr);
  assert.ok(result.eagerChatHelp.stdout.startsWith('Usage: llm chat [OPTIONS]\n'));
  assert.equal(result.invalidChatEnvironment.exitCode, 2);
  assert.equal(result.invalidChatEnvironment.stderr, "Usage: llm chat [OPTIONS]\nTry 'llm chat -h' for help.\n\nError: Invalid value for '--td' / '--tools-debug': 'invalid' is not a valid boolean.\n");
  assert.equal(result.wireChat.exitCode, 0, result.wireChat.stderr);
  const system = content => ({role:'system',content}), user = content => ({role:'user',content});
  assert.deepEqual(result.chatWire, [
    [system('one'), user('one')],
    [system('one'), user('one'), user('one')],
    [system('one'), user('one'), user('one'), system('two'), user('two')]
  ]);
  assert.deepEqual(result.chatPrompts, ['one', 'two', 'three', 'edited prompt', 'body\nexit\n']);
  assert.ok(result.chat.stdout.endsWith('> 1\n> 2\n> '), result.chat.stdout);
  assert.ok(result.editedChat.stdout.endsWith('> 1\n> '), result.editedChat.stdout);
  assert.ok(result.freshChat.stdout.endsWith('> 1\n> '), result.freshChat.stdout);
  assert.equal(result.serial.stdout,'2,5,'+'😀'.repeat(4096)+'\n');
  assert.equal(result.concurrent.stdout,'first,second\n');
  assert.equal(result.defaultTool.stdout,'0.27.1\n');
  assert.deepEqual(JSON.parse(result.plugins.stdout).map(plugin=>({...plugin,hooks:[...plugin.hooks].sort()})),[{name:'llm-safe-host',hooks:['register_embedding_models','register_models'],version:'0.1'}]);
  assert.deepEqual(JSON.parse(result.pluginTools.stdout),[{name:'llm.default_plugins.default_tools',hooks:['register_tools']}]);
  assert.equal(result.missingPlugins.stdout,'[]\n');
  assert.equal(result.unknownTool.exitCode,1);
  assert.ok(result.unknownTool.stderr.includes('Tool(s) missing_tool not found.'));
  assert.equal(result.brokenFunction.exitCode,1);
  assert.ok(result.brokenFunction.stderr.includes('Error in --functions definition:'));
  assert.equal(result.toolboxSerial.stdout,'25,25\n');
  assert.equal(result.toolboxAsync.stdout,'205,205\n');
  assert.deepEqual(JSON.parse(result.toolboxListing.stdout).toolboxes.map(box=>({name:box.name,tools:box.tools.map(tool=>tool.name)})),[{name:'Counter',tools:['_Counter_add','_Counter_peek']}]);
  assert.equal(result.cancelled,true);
  assert.equal(result.preparationCancelled,true);
  assert.deepEqual(result.retained,[]);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd installs and reuses explicitly authorized Python wheels', {timeout:120000}, async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path, 'Set SAFE_BASH_PYTHON_MICROPIP_WHEEL to the pinned micropip 0.11.1 wheel');
  const bytes=readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
  const {miniflare,runtimeErrors}=nativeFixture;
  for(const mode of ['packages','llm-packages']) {
    const response=await miniflare.dispatchFetch('http://fixture/'+mode,{method:'POST',body:bytes});
    const result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.installed.exitCode,0,JSON.stringify(result));
    assert.equal(result.installed.stdout,'Successfully installed requested Python packages\n');
    assert.equal(result.installed.stderr,'');
    assert.equal(result.imported.exitCode,0,JSON.stringify(result));
    assert.equal(result.imported.stdout,'worker package verified\n');
    assert.equal(result.imported.stderr,'');
    assert.notEqual(result.conflict.exitCode,0);
    assert.equal(result.recovered.exitCode,0,JSON.stringify(result));
    assert.equal(result.recovered.stdout,'worker package verified\n');
    assert.equal(result.recovered.stderr,'');
    assert.equal(result.requests.length,1);
    assert.deepEqual(result.failures,[]);
    assert.equal(result.native.length,mode==='llm-packages'?4:0);
    if(mode==='llm-packages' && process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT) {
      const output=resolve(process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT);
      assert.ok(output.startsWith(resolve(root,'out')+'/'));
      await writeFile(output,result.installed.stdout+'\n'+result.native[0].output);
    }
    for(const actual of result.native) {
      const expected=packageCommandReference.find(row=>JSON.stringify(row.args)===JSON.stringify(actual.args));
      assert.ok(expected);
      assert.deepEqual(actual,{args:expected.args,exitCode:expected.exitCode,output:expected.output});
    }
  }
  assert.deepEqual(runtimeErrors,[]);
  const errors=await miniflare.dispatchFetch('http://fixture/unhandled-errors');
  assert.deepEqual(await errors.json(),[]);
});
