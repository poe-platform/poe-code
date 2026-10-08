import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

import packageControlsReference from '../../../safe-bash-command-python/src/fixtures/package-controls-pip-21.2.4.json' with {type:'json'};
import uninstallReference from '../../../safe-bash-command-python/src/fixtures/uninstall-pip-21.2.4.json' with {type:'json'};
import missingArtifactReference from '../../../safe-bash-command-python/src/fixtures/uninstall-missing-artifacts-pip-21.2.4.json' with {type:'json'};
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
export const nativeWheelAssets = [${dependencyArchives.map((archive,index) => `{file:${JSON.stringify(archive.fileName)},bytes:new Uint8Array(dependency${index})}`).join(',')}];
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
        '@poe-platform/safe-bash/commands/python/source-archive': resolve(root, 'packages/safe-bash/src/commands/python/source-archive.ts'),
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
  if (!nativeFixture) return;
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
  const errors = await nativeFixture.miniflare.dispatchFetch('http://fixture/unhandled-errors');
  assert.deepEqual(await errors.json(), [], 'LLM input cancellation must settle every owned promise');
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


test('real workerd applies prerelease selection and cache bypass through CLI and SDK', {timeout:180000}, async()=>{
  const bytes=readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL);
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/package-controls',{method:'POST',body:bytes});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  for(const row of result.results) {
    if(row.installed)assert.equal(row.installed.exitCode,0,JSON.stringify(result));
    assert.equal(row.version.exitCode,0,JSON.stringify(result));
    const expected=packageControlsReference.rows.find(value=>value.profile===(row.profile==='sdk'?'pre':row.profile));
    assert.equal(row.version.stdout,expected.version+'\n');
    assert.equal(row.version.stderr,'');
    if(row.uncached) {
      assert.equal(row.uncached.exitCode,0,JSON.stringify(result));
      assert.ok(row.additionalRequests.includes('https://packages.example/worker_candidate-1.0-py3-none-any.whl'));
    }
  }
  assert.ok(result.requests.some(url=>url.endsWith('worker_candidate-2.0rc1-py3-none-any.whl.metadata')));
  assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});

for(const [defaultCache,streamOnly,weakCache] of [[false,false,false],[true,false,false],[true,true,false],[false,false,true],[true,false,true]])test('real workerd loads native code from a retained installed wheel; defaultCache='+defaultCache+(streamOnly?'; streamOnly=true':'')+(weakCache?'; weakCache=true':''), {timeout:60000},async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/native-wheel'+(defaultCache?'?default-cache':'')+(streamOnly?'&stream-only':'')+(weakCache?(defaultCache?'&':'?')+'weak-cache':''),{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 assert.equal(result.result.exitCode,0,JSON.stringify(result));
 assert.equal(result.result.stdout,'42\n');
 assert.equal(result.result.stderr,'');
 assert.deepEqual(result.diagnostics,[]);
 assert.deepEqual(result.failures,[]);
 assert.ok(result.requests.some(url=>url.includes('pydantic_core-2.41.5')));
 assert.ok(result.stagedBytes>0);assert.ok(result.maxWrite>0&&result.maxWrite<=65536);
 if(streamOnly)assert.ok(result.canonicalBytes>2097159,'canonical source must stream into caller storage');
 assert.ok(result.wheelReadMaximum>0&&result.wheelReadMaximum<=65558);
 assert.equal(result.wheelIndexEntries,weakCache?2:1,'native extraction and discovery must share one wheel index per invocation');
 if(weakCache){assert.equal(result.replay.exitCode,0,JSON.stringify(result));assert.equal(result.replay.stdout,'42\n');assert.equal(result.replay.stderr,'');assert.equal(result.replayRequests,0);}
 assert.ok(result.wheelLiveMaximum>0&&result.wheelLiveMaximum<10,'native entry retention: '+result.wheelLiveMaximum);
 assert.ok(result.wheelNameQueries>0,'native filename discovery observed');
 assert.equal(result.wheelNameMaximum,0,'native filename discovery must stay lazy');
 assert.equal(result.wheelExtractedMaximum,0,'extracted wheel payloads must use caller storage');
 assert.deepEqual(runtimeErrors,[]);
});

test('real workerd settles invalid native wheel loading without fatal interpreter errors', {timeout:60000},async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/native-wheel?invalid-native',{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 assert.notEqual(result.result.exitCode,0,JSON.stringify(result));
 assert.ok(result.diagnostics.some(message=>message.includes("broken.cpython-314-wasm32-emscripten.so") && message.includes("RangeError: byte length of Uint32Array should be a multiple of 4")),JSON.stringify(result));
 assert.equal(result.wheelDynlibCandidates,1,'discovery must stop at the first rejected library');
 assert.deepEqual(result.failures,[]);
 assert.deepEqual(runtimeErrors,[]);
});

for(const format of ['directory','zip','tar','named','remote','remote-pep517','remote-pep517-md5','remote-pep517-sha512','local-pep517-md5','local-pep517-sha512','remote-metadata','remote-metadata-zip','remote-redirect','remote-extensionless','remote-extensionless-zip','subdirectory','setup-requires','editable','llm-editable','editable-extras','editable-file'])test(`real workerd builds ${(format.startsWith('remote-pep517')||format.startsWith('local-pep517'))?'PEP 517 source':'legacy setup'} projects with genuine isolated tooling; archive=${format}`, {timeout:90000}, async()=>{
  const extras=format==='editable-extras'||format==='editable-file',editable=format==='editable'||format==='llm-editable'||extras;
  const directory=process.env.SAFE_BASH_PYTHON_BUILD_WHEELS_ROOT;
  assert.ok(directory,'Set SAFE_BASH_PYTHON_BUILD_WHEELS_ROOT to authenticated runtime build wheels');
  const lock=JSON.parse(files['pyodide-lock.json']).packages;
  const assets=['setuptools','pyparsing'].map(name=>{
    const entry=lock[name],bytes=readFileSync(resolve(directory,entry.file_name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    return {file:entry.file_name,bytes:Array.from(bytes)};
  });
  const micropip=readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL);
  assert.equal(createHash('sha256').update(micropip).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
  assets.push({file:'micropip-0.11.1-py3-none-any.whl',bytes:Array.from(micropip)});
  const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/legacy-build?archive='+format,{method:'POST',body:JSON.stringify(assets)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  if(format.startsWith('remote-metadata'))assert.notEqual(result.rejected.exitCode,0,JSON.stringify(result));
  if(format==='remote-metadata-zip')assert.ok(result.rejected.stderr.includes('File "setup.py" not found'),result.rejected.stderr);
  if(format==='directory'){
    assert.notEqual(result.rejected.exitCode,0,JSON.stringify(result.rejected));
    assert.ok(result.rejected.stderr.includes("Directory './empty-project' is not installable. Neither 'setup.py' nor 'pyproject.toml' found."),result.rejected.stderr);
  }
  for(const key of ['installed','imported','restored'])assert.equal(result[key].exitCode,0,JSON.stringify(result));
  assert.equal(result.imported.stdout,'["'+(editable?'changed':'legacy-original')+'", false, false, '+extras+']\n');
  assert.equal(result.restored.stdout,result.imported.stdout);
  assert.notEqual(result.failed.exitCode,0);
  assert.deepEqual(result.records,[...extras?['build-helper']:[],'legacy-fixture']);
  assert.ok(result.buildEntries.every(name=>!name.startsWith('.python-')));
  assert.equal(result.requests.some(url=>url.endsWith(lock.setuptools.file_name)),!(format.startsWith('remote-pep517')||format.startsWith('local-pep517')));
  if((format.startsWith('remote-pep517')||format.startsWith('local-pep517'))){
    assert.notEqual(result.rejected.exitCode,0,JSON.stringify(result.rejected));
    assert.deepEqual(result.rejectedBuildEntries,[]);
    assert.equal(result.provenance.exitCode,0,JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.provenance.stdout),{url:format.startsWith('local-pep517')?'file:///work/legacy-source.tar.gz':'https://build.test/legacy-source.tar.gz',archive_info:{hash:result.hashName+'='+result.sourceDigest},subdirectory:'nested'});
  }
  if(format==='remote-redirect'){
    assert.equal(result.sourceReplay.url,'https://build.test/legacy-source.tar.gz');
    assert.deepEqual(result.sourceReplay.headers,[['content-disposition','attachment; filename="legacy-source.tar.gz"']]);
    assert.equal(result.replayedWithoutNetwork,true);
  }
  if(editable){
    assert.equal(result.metadata.exitCode,0,JSON.stringify(result));
    assert.equal(result.metadata.stdout,'1.0\nNone\n');
    assert.equal(result.uninstalled.exitCode,0,JSON.stringify(result));
    assert.notEqual(result.removed.exitCode,0);
    assert.equal(result.sourceRetained,'value = "changed"\n');
  }
  assert.deepEqual(result.failures,[]);assert.deepEqual(nativeFixture.runtimeErrors,[]);
});

for(const phase of ['isolation','wheel','source'])test('real workerd isolates build dependencies and preserves target packages after build failure; '+phase, {timeout:90000}, async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path);
  const bytes=readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
  const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/build-environment/'+phase,{method:'POST',body:bytes});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  if(phase==='isolation'){
    for(const key of ['installed','buildInstalled','buildState','buildRecovered','targetState'])assert.equal(result[key].exitCode,0,JSON.stringify(result));
    assert.notEqual(result.failed.exitCode,0);
    assert.equal(result.buildState.stdout,'[null, "1.0", "1.0"]\n');
    assert.equal(result.buildRecovered.stdout,result.buildState.stdout);
    assert.equal(result.targetState.stdout,'["1.0", null, null]\n');
    assert.equal(result.targetUnchanged,true);
  }else if(phase==='wheel'){
    assert.equal(result.targetState.exitCode,0,JSON.stringify(result));
    assert.equal(result.targetState.stdout,'["1.0", null, null]\n');
    assert.equal(result.targetUnchanged,true);
    assert.deepEqual(result.buildSystem,{requires:['worker-dependency @ file:///work/worker_dependency-1.0-py3-none-any.whl'],backend:'backend:factory',backendPath:['.'],check:[]});
    assert.deepEqual(result.invalidBuildSystem,{name:'InstallationError',message:"fixture has a pyproject.toml file that does not comply with PEP 518: 'build-system.requires' contains an invalid requirement: 'bad @@@'"});
    assert.deepEqual(result.hookRequirements,['worker-fixture @ file:///work/worker_fixture-1.0-py3-none-any.whl']);
    assert.ok(result.built.startsWith('file:///work/published-wheels/'));
    assert.ok(result.built.endsWith('/built_fixture-1.0-py3-none-any.whl'));
    assert.ok(result.hookOutput.endsWith('native build requirements\nnative build wheel\n'));
    assert.equal(result.hookOutput.split('native build requirements\n').length,3);
    assert.equal(result.builtInstalled.exitCode,0,JSON.stringify(result));
    assert.equal(result.builtImported.exitCode,0,JSON.stringify(result));
    assert.equal(result.builtImported.stdout,'caller source:73\n');
  }else{
    assert.equal(result.sourceInstalled.exitCode,0,JSON.stringify(result));
    assert.equal(result.sourceImported.exitCode,0,JSON.stringify(result));
    assert.equal(result.sourceImported.stdout,'changed original:73\n');
    assert.equal(result.sourceMetadata.exitCode,0,JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.sourceMetadata.stdout),{dir_info:{},url:'file:///work/build-source'});
    assert.equal(result.sourceUninstalled.exitCode,0,JSON.stringify(result));
    assert.notEqual(result.sourceRemoved.exitCode,0);
  }
  assert.ok(result.wheelReads.opened>0);
  assert.equal(result.wheelReads.closed,result.wheelReads.opened);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});

for(const mode of ['packages','llm-packages'])test('real workerd installs and reuses explicitly authorized Python wheels; '+mode, {timeout:240000}, async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path, 'Set SAFE_BASH_PYTHON_MICROPIP_WHEEL to the pinned micropip 0.11.1 wheel');
  const bytes=readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/'+mode,{method:'POST',body:bytes});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.installed.exitCode,0,JSON.stringify(result));
  assert.equal(result.installed.stdout,'Successfully installed requested Python packages\n');
  assert.ok(result.wheelReads.opened>0);
  assert.equal(result.wheelReads.closed,result.wheelReads.opened);
  assert.ok(result.wheelReads.reads>result.wheelReads.opened);
  assert.ok(result.wheelReads.largest<=65536);
  assert.equal(result.installed.stderr,'');
  assert.equal(result.imported.exitCode,0,JSON.stringify(result));
  assert.equal(result.imported.stdout,'worker package verified\n');
  assert.equal(result.imported.stderr,'');
  assert.notEqual(result.conflict.exitCode,0);
  assert.equal(result.recovered.exitCode,0,JSON.stringify(result));
  assert.equal(result.recovered.stdout,'worker package verified\n');
  assert.equal(result.recovered.stderr,'');
  assert.equal(result.retained.exitCode,0,JSON.stringify(result));
  assert.equal(result.retained.stdout,'exact package state restored\n');
  assert.equal(result.retained.stderr,'');
  assert.notEqual(result.rejectedSnapshot.exitCode,0);
  assert.equal(result.rejectedSnapshot.stdout,'');
  assert.equal(result.repaired.exitCode,0,JSON.stringify(result));
  assert.equal(result.repairVerified.exitCode,0,JSON.stringify(result));
  assert.equal(result.repairVerified.stdout,'worker package verified\n');
  for(const key of ['declined','afterDecline','removed','afterRemoval','missing','restored','afterRestore','rootRemoved','afterRootRemoval'])assert.equal(result[key].exitCode,0,JSON.stringify(result));
  assert.ok(result.declined.stdout.includes('Proceed (Y/n)? '));
  assert.ok(!result.declined.stdout.includes('Successfully uninstalled'));
  assert.equal(result.afterDecline.stdout,'worker package verified\n');
  assert.ok(result.removed.stdout.includes('Successfully uninstalled worker-dependency-1.0'));
  assert.equal(result.afterRemoval.stdout,'dependency removed\n');
  assert.equal(result.missing.stderr,'WARNING: Skipping worker-dependency as it is not installed.\n');
  // Normalize only the runtime installation prefix; retain complete native output.
  for (const [key,row] of [['declined',0],['removed',1]]) {
    const expected=uninstallReference.rows[row];
    const output=result[key].stdout.replaceAll('worker-dependency','worker-fixture').replaceAll('worker_dependency','worker_fixture');
    const firstPath=output.split('\n').find(line=>line.startsWith('    /'));
    assert.ok(firstPath,output);
    const site=firstPath.trim().slice(0,firstPath.trim().indexOf('/worker_fixture'));
    assert.equal(output.replaceAll(site,'<site>'),expected.stdout);
    assert.equal(result[key].stderr,expected.stderr);
  }
  assert.equal(result.missing.stderr.replaceAll('worker-dependency','worker-fixture'),uninstallReference.rows[2].stderr);
  assert.equal(result.rootRemoved.stdout,uninstallReference.rows[3].stdout);
  assert.equal(result.rootRemoved.stderr,uninstallReference.rows[3].stderr);
  assert.notEqual(result.protectedDependency.exitCode,0);
  assert.notEqual(result.eof.exitCode,0);
  assert.ok(!result.eof.stdout.includes('Successfully uninstalled'));
  assert.notEqual(result.protectedPackage.exitCode,0);
  assert.equal(result.afterRestore.stdout,'worker package verified\n');
  assert.equal(result.afterRootRemoval.stdout,'root removed; dependency retained\n');
  assert.equal(result.requests.length,1);
  assert.deepEqual(result.failures,[]);
  if(mode==='llm-packages') {
    assert.equal(result.plugins.exitCode,0,JSON.stringify(result));
    assert.deepEqual(JSON.parse(result.plugins.stdout),[{name:'worker-fixture',hooks:['register_fragment_loaders','register_template_loaders','register_tools'],version:'1.0'}]);
    assert.equal(result.plugins.stderr,'');
    for(const [kind,listing] of [['fragments',result.fragmentListing],['templates',result.templateListing]]){
      assert.equal(listing.exitCode,0,JSON.stringify(listing));
      assert.equal(listing.stdout,'register '+kind+'\nnative:\n  Undocumented\n');
      assert.equal(listing.stderr,'');
    }
    assert.equal(result.listed.exitCode,0,JSON.stringify(result));
    assert.match(result.listed.stdout,/installed_tool/);
    assert.equal(result.called.exitCode,0,JSON.stringify(result));
    assert.equal(result.called.stdout,'78\n');
    assert.equal(result.called.stderr,'');
    assert.equal(result.fragment.exitCode,0,JSON.stringify(result.fragment));
    assert.match(result.fragment.stdout,/native fragment:hello/);
    assert.match(result.fragment.stdout,/prompt/);
    assert.ok(result.fragment.stdout.startsWith('register fragments\nplugin output\n'));
    assert.equal(result.fragment.stdout.split('register fragments').length,2);
    assert.ok(!result.fragment.stdout.includes('register templates'));
    assert.equal(result.fragment.stderr,'plugin diagnostic\n');
    assert.equal(result.template.exitCode,0,JSON.stringify(result.template));
    assert.equal(result.template.stdout,'register templates\ntemplate output\nnative template:hello Ada question\n');
    assert.equal(result.template.stderr,'template diagnostic\n');
    for(const [kind,missing]of [['fragment',result.missingFragment],['template',result.missingTemplate]]){
      assert.equal(missing.exitCode,1,JSON.stringify(missing));
      assert.equal(missing.stdout,'register '+kind+'s\n');
      assert.equal(missing.stderr,'Error: Unknown '+kind+' prefix: missing\n');
    }
    for(const [kind,failed]of [['fragments',result.failedFragment],['templates',result.failedTemplate]]){
      assert.equal(failed.exitCode,1,JSON.stringify(failed));
      assert.equal(failed.stdout,'register '+kind+'\n');
      assert.equal(failed.stderr,'Error: '+kind+' registration failed\n');
    }
    for(const failed of [result.importFragment,result.importTemplate]){
      assert.equal(failed.exitCode,1,JSON.stringify(failed));
      assert.equal(failed.stdout,'');
      assert.equal(failed.stderr,'Error: plugin import failed\n');
    }
    assert.equal(result.blocked.exitCode,1);
    assert.match(result.blocked.stderr,/platform-configured providers/);
  }
  assert.equal(result.native.length,mode==='llm-packages'?6:0);
  if(mode==='llm-packages' && process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT) {
    const output=resolve(process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT);
    assert.ok(output.startsWith(resolve(root,'out')+'/'));
    await writeFile(output,result.removed.stdout+'\n'+result.installed.stdout+'\n'+result.plugins.stdout+'\n'+result.called.stdout);
  }
  for(const actual of result.native) {
    const expected=packageCommandReference.find(row=>JSON.stringify(row.args)===JSON.stringify(actual.args));
    assert.ok(expected);
    assert.deepEqual(actual,{args:expected.args,exitCode:expected.exitCode,output:expected.output});
  }
  assert.deepEqual(runtimeErrors,[]);
  const errors=await miniflare.dispatchFetch('http://fixture/unhandled-errors');
  assert.deepEqual(await errors.json(),[]);
});


test('real workerd preserves uncaught asyncio errors and immediately reuses interpreter capacity', {timeout:120000}, async () => {
  const response = await nativeFixture.miniflare.dispatchFetch('http://fixture/llm-async-errors');
  const result = await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  const expected = [ [1, "UnknownModelError: 'Unknown model: missing-model'"], [1,'ValueError: async failure'], [7,''], [1,'asyncio.exceptions.CancelledError'] ];
  assert.equal(result.results.length,expected.length);
  if (process.env.SAFE_BASH_ASYNC_ERROR_OUTPUT) {
    assert.ok(resolve(process.env.SAFE_BASH_ASYNC_ERROR_OUTPUT).startsWith(resolve(root,'out') + '/'));
    await writeFile(process.env.SAFE_BASH_ASYNC_ERROR_OUTPUT,result.results.map(item=>item.result.stderr + item.recovery.stdout).join('\n'));
  }
  for (const [index,item] of result.results.entries()) {
    const referencePython = process.env.SAFE_BASH_LLM_REFERENCE_PYTHON;
    assert.ok(referencePython, 'Set SAFE_BASH_LLM_REFERENCE_PYTHON to pinned llm==0.27.1');
    const reference = spawnSync(referencePython,['-c','import asyncio, llm\nasync def main():\n    await asyncio.sleep(0)\n    ' + item.body + '\nasyncio.run(main())\n'],{encoding:'utf8',timeout:5000});
    assert.ifError(reference.error);
    assert.equal(reference.status,expected[index][0],reference.stderr);
    assert.equal(item.result.exitCode,reference.status,item.result.stderr);
    assert.equal(item.result.stdout,reference.stdout);
    const exceptionType = expected[index][1].split(':')[0];
    if (exceptionType) assert.ok(reference.stderr.includes(exceptionType),reference.stderr);
    assert.equal(item.result.stdout,'');
    if (expected[index][1]) assert.ok(item.result.stderr.includes(expected[index][1]),item.result.stderr);
    else assert.equal(item.result.stderr,'');
    assert.equal(item.recovery.exitCode,0,item.recovery.stderr);
    assert.equal(item.recovery.stdout,'recovered\n');
    assert.equal(item.recovery.stderr,'');
  }
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd replaces requested packages while retaining unrelated installed versions', {timeout:180000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/package-replacements',{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 const reference=JSON.parse(readFileSync(new URL('../../../safe-bash-command-python/src/fixtures/package-replacement-pip-21.2.4.json',import.meta.url),'utf8'));
 const versions=reference.rows.map(row=>row.versions);
 assert.equal(result.rows.length,versions.length);
 for(const [index,row] of result.rows.entries()){
  assert.equal(row.result.exitCode,reference.rows[index].exitCode,JSON.stringify(row));
  assert.equal(row.versions.exitCode,0,JSON.stringify(row));
  assert.deepEqual(JSON.parse(row.versions.stdout),versions[index],row.command);
 }
 assert.deepEqual(result.protectedResults.map(row=>row.exitCode),[0,1]);
 assert.equal(result.sdk.length,2);
 for(const [index,row] of result.sdk.entries()){assert.equal(row.exitCode,0,JSON.stringify(row));assert.deepEqual(JSON.parse(row.stdout),index===0?['2.0','1.0','1.0']:['2.0','2.0','1.0']);}
 assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd migrates legacy requirements before uninstall without making them host requirements', {timeout:120000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 for(const mode of ['legacy-packages','legacy-llm-packages']){
  const response=await miniflare.dispatchFetch('http://fixture/'+mode,{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.rows.length,2);
  for(const [index,row] of result.rows.entries()){
   assert.notEqual(row.protectedCode,0,JSON.stringify(row));
   assert.deepEqual(row.protectedManifest,['file:///work/worker_dependency-1.0-py3-none-any.whl','file:///work/worker_fixture-1.0-py3-none-any.whl']);
   assert.equal(row.exitCode,0,JSON.stringify(row));assert.equal(row.stderr,'');
   assert.ok(row.stdout.includes('Successfully uninstalled '+row.target+'-1.0'),JSON.stringify(row));
   assert.equal(row.state.exitCode,0,JSON.stringify(row));
   assert.deepEqual(JSON.parse(row.state.stdout),index===0?['1.0',null,'1.0']:[null,'1.0','1.0']);
   assert.equal(row.manifest.version,3);
   assert.ok(!row.manifest.installed.some(source=>source.startsWith(row.target)),JSON.stringify(row));
  }
  if(mode==='legacy-llm-packages' && process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT){
   const output=resolve(process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT);
   assert.ok(output.startsWith(resolve(root,'out')+'/'));
   await writeFile(output,result.rows.map(row=>row.stdout).join('\n'));
  }
  assert.deepEqual(result.failures,[]);
 }
 assert.deepEqual(runtimeErrors,[]);
});


test('real workerd uninstalls packages after their wheel artifacts are gone', {timeout:120000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 for(const mode of ['artifact-uninstall','artifact-llm-uninstall']){
  const response=await miniflare.dispatchFetch('http://fixture/'+mode,{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  for(const name of ['declined','removed','dependency','missing','state'])assert.equal(result[name].exitCode,0,JSON.stringify(result));
  assert.notEqual(result.protectedResult.exitCode,0,JSON.stringify(result));
  assert.ok(result.diagnostics.some(value=>value.includes('host-required')),JSON.stringify(result));
  assert.ok(result.declined.stdout.includes('/worker_fixture/*'),JSON.stringify(result));
  assert.ok(!result.declined.stdout.includes('Successfully uninstalled'));
  assert.ok(result.removed.stdout.endsWith('Successfully uninstalled worker-fixture-1.0\n'));
  assert.ok(result.dependency.stdout.endsWith('Successfully uninstalled worker-dependency-1.0\n'));
  assert.equal(result.missing.stderr,'WARNING: Skipping worker-fixture as it is not installed.\n');
  for(const [index,key] of ['declined','removed','dependency','missing'].entries()){
   const output=result[key].stdout;
   const firstPath=output.split('\n').find(line=>line.startsWith('    /'));
   const site=firstPath?.trim().split('/worker_fixture')[0];
   assert.equal(site?output.replaceAll(site,'<site>'):output,missingArtifactReference.rows[index].stdout);
   assert.equal(result[key].stderr,missingArtifactReference.rows[index].stderr);
  }
  assert.equal(result.rejected.length,4);
  for(const row of result.rejected){assert.notEqual(row.exitCode,0,JSON.stringify(row));assert.equal(row.untouched,true,JSON.stringify(row));}
  assert.deepEqual(result.manifest.installed,[]);
  assert.equal(result.state.stdout,'empty environment recovered\n');
  if(mode==='artifact-llm-uninstall' && process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT){
   const output=resolve(process.env.SAFE_BASH_LLM_PACKAGE_OUTPUT);
   assert.ok(output.startsWith(resolve(root,'out')+'/'));
   await writeFile(output,result.removed.stdout+result.dependency.stdout);
  }
  assert.deepEqual(result.failures,[]);
 }
 assert.deepEqual(runtimeErrors,[]);
});

test('real workerd processes installed package paths like native Python before user imports',{timeout:90000},async()=>{
  const reference=spawnSync(process.env.SAFE_BASH_LLM_REFERENCE_PYTHON,['-B','-c',String.raw`
import io,json,site,sys,__main__
from types import SimpleNamespace
from unittest.mock import patch
content=b"# comment\n/work/pth-source\n/work/pth-source\n/work/missing\nimport sys, __main__; sys._fixture_pth_runs = getattr(sys, '_fixture_pth_runs', 0) + 1; __main__._pth_marker = 'ready'; sys._fixture_pth_argv = list(sys.argv)\n"
sys.argv=['-c']
exists=site.os.path.exists
open_code=site.io.open_code
lstat=site.os.lstat
with patch('site.os.listdir',return_value=['fixture.pth']),patch('site.os.lstat',side_effect=lambda path:SimpleNamespace(st_flags=0,st_file_attributes=0) if path=='/fixture-site/fixture.pth' else lstat(path)),patch('site.io.open_code',side_effect=lambda path:io.BytesIO(content) if path=='/fixture-site/fixture.pth' else open_code(path)),patch('site.os.path.exists',side_effect=lambda path:path=='/work/pth-source' or exists(path)):
 site.addsitedir('/fixture-site')
print(json.dumps([sys.path.count('/work/pth-source'),sys._fixture_pth_runs,__main__._pth_marker,sys._fixture_pth_argv]))
`],{encoding:'utf8',timeout:5000});
  assert.ifError(reference.error);assert.equal(reference.status,0,reference.stderr);
  const bytes=readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
  const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/package-paths',{method:'POST',body:bytes});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  for(const [name,value] of [['first',13],['changed',1313]]){
    assert.equal(result[name].exitCode,0,JSON.stringify(result));
    assert.deepEqual(JSON.parse(result[name].stdout),[value,...JSON.parse(reference.stdout)]);
  }
  assert.deepEqual(result.failures,[]);assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd verifies every pinned pip direct wheel hash before publication', {timeout:90000},async()=>{
 const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/wheel-integrity',{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 assert.deepEqual(result.rows.map(row=>row.algorithm),['sha1','sha224','sha384','sha256','sha512','md5']);
 for(const row of result.rows){
  assert.equal(row.valid.exitCode,0,JSON.stringify(row));
  assert.notEqual(row.invalid.exitCode,0,JSON.stringify(row));
  assert.ok(result.diagnostics.some(value=>value.includes('integrity mismatch')));
  assert.equal(row.unchanged,true,JSON.stringify(row));
 }
 assert.equal(result.wheelReads.opened,result.wheelReads.closed);
 assert.ok(result.wheelReads.largest<=65536);
 assert.deepEqual(result.failures,[]);
 assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd retains direct wheel provenance for roots and dependencies across restoration', {timeout:90000},async()=>{
 const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/wheel-provenance',{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 for(const key of ['installed','provenance','restored','indexed','indexProvenance','indexRestored','removed','retained'])assert.equal(result[key].exitCode,0,JSON.stringify(result));
 const expected=Object.fromEntries(['worker-fixture','worker-dependency'].map(name=>[name,{url:'file:///work/'+name.replaceAll('-','_')+'-1.0-py3-none-any.whl',archive_info:{}}]));
 for(const key of ['provenance','restored','retained'])assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(result[key].stdout)).map(([name,value])=>[name,JSON.parse(value)])),expected);
 for(const key of ['indexProvenance','indexRestored'])assert.equal(result[key].stdout,'None\n',JSON.stringify(result));
 assert.equal(result.wheelReads.opened,result.wheelReads.closed);assert.ok(result.wheelReads.largest<=65536);
 assert.deepEqual(result.failures,[]);assert.deepEqual(nativeFixture.runtimeErrors,[]);
});


test('real workerd preserves explicit native plugin exit statuses', {timeout:60000}, async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path, 'Set SAFE_BASH_PYTHON_MICROPIP_WHEEL to the pinned micropip wheel');
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-plugin-exits',{method:'POST',body:readFileSync(path)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  for(const [kind,exited,code]of [['fragments',result.fragment,0],['templates',result.template,7]]){
    assert.equal(exited.exitCode,code,JSON.stringify(exited));
    assert.equal(exited.stdout,'register '+kind+'\n');
    assert.equal(exited.stderr,'');
  }
  assert.deepEqual(result.tools.map(({exitCode,stdout,stderr})=>({exitCode,stdout,stderr})),[
    {exitCode:0,stdout:'',stderr:''},{exitCode:0,stdout:'',stderr:''},
    {exitCode:7,stdout:'',stderr:''},{exitCode:1,stdout:'',stderr:'tool exit\n'},
  ]);
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(runtimeErrors,[]);
});


test('real workerd preserves tool execution and preparation process exits',{timeout:60000},async()=>{
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-tool-exits');
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.deepEqual(result.results.map(({exitCode,stdout,stderr,requests})=>({exitCode,stdout,stderr,requests})),[
    {exitCode:0,stdout:'tool stdout\n',stderr:'',requests:1},
    {exitCode:7,stdout:'tool stdout\n',stderr:'',requests:1},
    {exitCode:0,stdout:'tool stdout\n',stderr:'',requests:1},
    {exitCode:1,stdout:'tool stdout\n',stderr:'tool exit\n',requests:1},
    {exitCode:9,stdout:'tool stdout\n',stderr:'Error: formatted preparation failure\n',requests:1},
    {exitCode:9,stdout:'tool stdout\n',stderr:'Error: formatted preparation failure\n',requests:1},
    {exitCode:1,stdout:'tool stdout\n',stderr:'\nAborted!\n',requests:1},
    {exitCode:1,stdout:'tool stdout\n',stderr:'\nAborted!\n',requests:1},
    {exitCode:1,stdout:'tool stdout\n',stderr:'\nAborted!\n',requests:1},
    {exitCode:1,stdout:'tool stdout\n',stderr:'\nAborted!\n',requests:1},
  ]);
  assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd preserves native Click plugin diagnostics and custom exit status',{timeout:60000},async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path,'Set SAFE_BASH_PYTHON_MICROPIP_WHEEL to the pinned micropip wheel');
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-click-errors',{method:'POST',body:readFileSync(path)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.deepEqual(result.results.map(({exitCode,stdout,stderr})=>({exitCode,stdout,stderr})),
    ['register templates\n','register fragments\n','register templates\n','register fragments\n',''].map(stdout=>({exitCode:9,stdout,stderr:'Error: formatted plugin failure\n'})));
  assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd preserves native plugin keyboard interrupts',{timeout:60000},async()=>{
  const path=process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL;
  assert.ok(path);
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-interrupts',{method:'POST',body:readFileSync(path)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.deepEqual(result.results.map(({exitCode,stdout,stderr})=>({exitCode,stdout,stderr})),[
    ...['register templates\n','register fragments\n','','register templates\n','register fragments\n','register templates\n','register fragments\n'].map(stdout=>({exitCode:1,stdout,stderr:'\nAborted!\n'})),
  ]);
  assert.deepEqual(result.diagnostics,[]);
  assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd preserves native toolbox EOF and Click aborts',{timeout:60000},async()=>{
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-tool-aborts');
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.deepEqual(result.results.map(({exitCode,stdout,stderr,requests})=>({exitCode,stdout,stderr,requests})),
    ['\nAborted!\n','\nAborted!\n','Aborted!\n','Aborted!\n'].map(stderr=>({exitCode:1,stdout:'tool stdout\n',stderr,requests:1})));
  assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});

for(const mode of ['eof','abort'])test('real workerd preserves native plugin abort boundaries; mode='+mode,{timeout:60000},async()=>{
  const {miniflare,runtimeErrors}=nativeFixture;
  const response=await miniflare.dispatchFetch('http://fixture/llm-'+mode,{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.deepEqual(result.results.map(({exitCode,stdout,stderr})=>({exitCode,stdout,stderr})),
    ['register templates\n','register fragments\n','register templates\n','register fragments\n',''].map(stdout=>({exitCode:1,stdout,stderr:mode==='eof'?'\nAborted!\n':'Aborted!\n'})));
  assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd streams network wheels through caller staging and an S3 cache',{timeout:60000},async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/network-cache');
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 assert.deepEqual(result.results,[{size:150000,bytes:[42,42]},{size:150000,bytes:[42,42]}]);
 assert.equal(result.uploads,1);assert.equal(result.requests,1);assert.equal(result.disposed,1);
 assert.ok(result.maximum>0&&result.maximum<=65536);assert.equal(result.staging,0);
 assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd applies package constraints without installing unused roots', {timeout:180000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/package-constraints',{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 const reference=JSON.parse(readFileSync(new URL('../../../safe-bash-command-python/src/fixtures/package-constraints-pip-21.2.4.json',import.meta.url),'utf8'));
 assert.deepEqual(result.rows.map(row=>row.result.exitCode),reference.rows.slice(0,3).map(row=>row.exitCode),JSON.stringify(result));
 for(const [index,row] of result.rows.entries()){
  assert.equal(row.versions.exitCode,0,JSON.stringify(row));
  const versions=Object.fromEntries(Object.entries(JSON.parse(row.versions.stdout)).map(([name,value])=>[name.replaceAll('_','-'),value]));
  assert.deepEqual(versions,reference.rows[index].versions,JSON.stringify(row));
 }
 assert.equal(result.sdk.exitCode,0,JSON.stringify(result.sdk));
 assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(result.sdk.stdout)).map(([name,value])=>[name.replaceAll('_','-'),value])),reference.rows[3].versions);
 assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});

for(const streamed of [false,true])test('real workerd suppresses runtime dependencies through CLI and SDK; streamed manifest='+streamed, {timeout:180000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/package-no-deps'+(streamed?'?streamed-manifest':''),{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 const reference=JSON.parse(readFileSync(new URL('../../../safe-bash-command-python/src/fixtures/package-no-deps-pip-21.2.4.json',import.meta.url),'utf8'));
 for(const [index,row] of result.rows.entries()){
  assert.equal(row.result.exitCode,reference.rows[index].exitCode,JSON.stringify(row));
  assert.equal(row.versions.exitCode,0,JSON.stringify(row));
  assert.deepEqual(JSON.parse(row.versions.stdout),reference.rows[index].versions);
 }
 assert.equal(result.sdk.exitCode,0,JSON.stringify(result.sdk));
 assert.deepEqual(JSON.parse(result.sdk.stdout),reference.rows[4].versions);
 if(streamed){assert.ok(result.manifestTransfer.commits>0);assert.ok(result.manifestTransfer.chunks>=result.manifestTransfer.commits);assert.ok(result.manifestTransfer.maximum>0&&result.manifestTransfer.maximum<=65536);assert.equal(result.manifestTransfer.staging,0);}
 else assert.deepEqual(result.manifestTransfer,{chunks:0,maximum:0,commits:0});
 assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
 });

for(const fromFile of [false,true])test('real workerd selects candidates across package indexes and honors no-index; requirement files='+fromFile, {timeout:180000}, async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/'+(fromFile?'requirement-indexes':'package-indexes'),{method:'POST',body:readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL)});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
 const reference=JSON.parse(readFileSync(new URL('../../../safe-bash-command-python/src/fixtures/package-indexes-pip-21.2.4.json',import.meta.url),'utf8'));
 assert.equal(result.rows.length,reference.rows.length);
 for(const [index,row] of result.rows.entries()){
  assert.equal(row.result.exitCode,reference.rows[index].exitCode,JSON.stringify(row));
  assert.equal(row.versions.exitCode,0,JSON.stringify(row));
  assert.deepEqual(JSON.parse(row.versions.stdout),reference.rows[index].versions);
 }
 assert.deepEqual(result.rows.slice(2).map(row=>row.queries),[[],[]]);
 assert.equal(result.sdk.exitCode,0,JSON.stringify(result.sdk));
 assert.deepEqual(JSON.parse(result.sdk.stdout),reference.rows[1].versions);
 assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});


test('real workerd scandir consumes caller directory entries lazily and closes early cursors',{timeout:60000},async()=>{
 const {miniflare,runtimeErrors}=nativeFixture;
 const response=await miniflare.dispatchFetch('http://fixture/directory-cursors');
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
 assert.equal(result.result.exitCode,0,JSON.stringify(result));assert.equal(result.result.stdout,'scandir-ok\n');assert.equal(result.result.stderr,'');
 assert.equal(result.opened,3);assert.equal(result.closed,3);assert.equal(result.consumed,4);
 assert.deepEqual(result.failures,[]);assert.deepEqual(runtimeErrors,[]);
});

for(const mode of ['metadata-discovery','metadata-plain'])test('real workerd stores metadata lookup groups in caller storage and retires suspended searches; '+mode,{timeout:90000},async()=>{
 const bytes=readFileSync(process.env.SAFE_BASH_PYTHON_MICROPIP_WHEEL);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8');
 const response=await nativeFixture.miniflare.dispatchFetch('http://fixture/'+mode,{method:'POST',body:bytes});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
 assert.equal(result.metadata.exitCode,0,JSON.stringify(result));
 assert.equal(result.metadata.stdout,'metadata-ok\n');assert.equal(result.metadata.stderr,'');
 assert.deepEqual(result.failures,[]);assert.deepEqual(nativeFixture.runtimeErrors,[]);
});
