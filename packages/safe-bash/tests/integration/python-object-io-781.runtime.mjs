import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { createPythonJspiCallbackCatalog } from './python-jspi-catalog.mjs';
import { selectObjectIo781WorkerdLauncher } from './python-object-io-781.tooling.mjs';

export async function createObjectIo781Runtime(context) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const tooling = process.env.SAFE_BASH_CF_RUNTIME_ROOT;
  const runtimeRoot = process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT;
  const consumerRoot = process.env.SAFE_BASH_PYTHON_CONSUMER_ROOT && resolve(process.env.SAFE_BASH_PYTHON_CONSUMER_ROOT);
  function publicEntry(name, subpath) {
    const packageRoot = resolve(consumerRoot, 'node_modules/@poe-platform', name);
    assert.equal(lstatSync(packageRoot).isSymbolicLink(), false, 'Public packages must be installed, not workspace links');
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    return resolve(packageRoot, manifest.exports[subpath].import);
  }
  if (consumerRoot) assert.ok(consumerRoot.startsWith(resolve(root, 'out') + '/'));
  assert.ok(tooling && runtimeRoot, 'Authentic HOME workerd and Pyodide tooling roots are required');
  assert.ok(process.env.TMPDIR?.startsWith(resolve(root, 'out/issue-781') + '/'));
  const require = createRequire(resolve(tooling, 'package.json'));
  assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
  assert.equal(require('workerd/package.json').version, '1.20260917.1');
  const workerdBinary = require('workerd').default;
  const launcher = selectObjectIo781WorkerdLauncher(tooling, workerdBinary, process.env.MINIFLARE_WORKERD_PATH);
  const binaryStat = lstatSync(workerdBinary);
  assert.ok(binaryStat.isFile() && !binaryStat.isSymbolicLink());
  const binaryDigest = createHash('sha256');
  for await (const chunk of createReadStream(workerdBinary)) binaryDigest.update(chunk);
  const workerdBinarySha256 = binaryDigest.digest('hex');
  assert.equal(workerdBinarySha256, '0484ac0dc3fc402881e5d9c459682333f1a9e6d0b89d2fa82f9fa67c065b2dde', 'Pinned official Linux x64 workerd bytes changed');
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
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
    files[name] = readFileSync(path);
    assert.equal(createHash('sha256').update(files[name]).digest('hex'), digest);
  }
  function embeddedModule(source, select) {
    const ast = ts.createSourceFile('pinned.mjs', source.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0);
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
  assert.equal(callbacks.length, 96);
  const callbackFiles = callbacks.map(({ signature }) => 'callback-' + signature + '.wasm');
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
${callbacks.map(({ bytes }, index) => ` { module:callback${index},bytes:new Uint8Array(${JSON.stringify(Array.from(bytes))}) },`).join('\n')}
]});
const { WebAssembly, fetch, location } = assets;
export { WebAssembly, fetch, location };
`;
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./python-object-io-781.worker.mjs', import.meta.url))],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', target: 'es2022', conditions: ['workerd', 'browser'],
    external: ['main.wasm', 'helper.wasm', 'ccall.wasm', 'empty.wasm', 'trampoline.wasm', 'native-call.wasm', 'stat-result.wasm', 'stdlib.bin', 'node:*', 'ws', ...callbackFiles],
    define: { 'globalThis.process': 'undefined', process: 'undefined' },
    alias: {
      'pinned-pyodide-loader': resolve(runtimeRoot, 'pyodide.mjs'),
      'pinned-pyodide-module': resolve(runtimeRoot, 'pyodide.asm.mjs'),
      'pinned-pyodide-lock': resolve(runtimeRoot, 'pyodide-lock.json'),
      '@poe-code/safe-fs/core': consumerRoot ? publicEntry('safe-fs', './core') : resolve(root, 'packages/safe-fs/src/core.ts'),
      '@poe-platform/safe-fs/core': consumerRoot ? publicEntry('safe-fs', './core') : resolve(root, 'packages/safe-fs/src/core.ts'),
      '@poe-platform/safe-fs/testing/object-publication': consumerRoot ? publicEntry('safe-fs', './testing/object-publication') : resolve(root, 'packages/safe-fs/src/testing/object-publication.ts'),
      '@poe-platform/safe-bash/commands/python': consumerRoot ? publicEntry('safe-bash', './commands/python') : resolve(root, 'packages/safe-bash/src/commands/python/index.ts'),
      ...(consumerRoot ? {} : { 'safe-bash-contracts': resolve(root, 'packages/safe-bash-contracts/src') }),
    }, inject: ['python-static-assets'], plugins: [{ name: 'python-static-assets', setup(plugin) {
      plugin.onResolve({ filter: /^python-static-assets$/ }, () => ({ path: 'assets', namespace: 'python-static-assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'python-static-assets' }, () => ({ contents: injection, loader: 'js', resolveDir: root }));
    } }] });
  const productInputs = [];
  const fixtureInputs = new Set([
    resolve(root, 'packages/safe-fs/src/testing/object-io-metrics.ts'),
    resolve(root, 'packages/safe-fs/src/testing/object-io-control.ts'),
    resolve(root, 'packages/safe-fs/tests/integration/object-staging-workerd.fixture.mjs'),
    ...['python-object-io-781.worker.mjs', 'python-jspi-errors.mjs'].map(name => resolve(dirname(fileURLToPath(import.meta.url)), name)),
  ]);
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const path = resolve(root, input);
    if (path.includes('/packages/') && !path.startsWith(resolve(runtimeRoot) + '/')) {
      if (consumerRoot && !fixtureInputs.has(path)) {
        assert.ok(path.startsWith(resolve(consumerRoot, 'node_modules') + '/'), 'Public mode forbids workspace runtime sources: ' + path);
      } else {
        assert.ok(path.startsWith(root + '/'), 'All bundled product packages must use exact candidate sources: ' + path);
      }
      productInputs.push({ path: path.slice(root.length + 1), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
  }
  const { createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult } = await import(pathToFileURL(
    consumerRoot ? publicEntry('safe-bash', './commands/python') : resolve(root, 'packages/safe-bash/src/commands/python/jspi-trampoline.ts')).href);
  const outputRoot = process.env.TMPDIR;
  const modules = [
    { type: 'ESModule', path: resolve(outputRoot, 'main.mjs'), contents: bundle.outputFiles[0].text },
    ...[['main.wasm', files['pyodide.asm.wasm']], ['helper.wasm', helper], ['ccall.wasm', ccall], ['empty.wasm', empty],
      ['trampoline.wasm', createPythonJspiTrampoline()], ['native-call.wasm', createPythonJspiNativeCall()],
      ['stat-result.wasm', createPythonJspiStatResult()]].map(([name, contents]) => ({ type: 'CompiledWasm', path: resolve(outputRoot, name), contents })),
    ...callbacks.map(({ bytes }, index) => ({ type: 'CompiledWasm', path: resolve(outputRoot, callbackFiles[index]), contents: bytes })),
    { type: 'Data', path: resolve(outputRoot, 'stdlib.bin'), contents: files['python_stdlib.zip'] },
  ];
  const runtimeErrors = [];
  const token = 'local-object-io-781-qualification-token';
  const requestOptions = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' } };
  const miniflare = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-09-17', cf: false,
    r2Buckets: ['SCRATCH'], r2Persist: resolve(outputRoot, 'r2'),
    bindings: { QUALIFICATION_TOKEN: token, QUALIFICATION_OWNER: 'local-issue-781-qualification', QUALIFICATION_EXPIRES_AT: String(Date.now() + 3600000) },
    handleStructuredLogs(entry) {
      if (entry.level === 'error') runtimeErrors.push(entry);
      context.diagnostic(JSON.stringify({ workerd: entry }));
    }, handleUncaughtError(error) { runtimeErrors.push({ uncaught: String(error) }); },
  }));
  const receipt = { root, artifact: consumerRoot ? 'installed-public-runtime-packages-with-candidate-measurement-fixture' : 'candidate-workspace-source',
    manifest, callbackModules: callbacks.length, productInputs,
    bundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),
    miniflare: require('miniflare/package.json').version, workerd: require('workerd/package.json').version,
    workerdLauncher: { ...launcher, binary: workerdBinary, binaryBytes: binaryStat.size, binarySha256: workerdBinarySha256,
      launcherSha256: launcher.mode === 'explicit-tooling-wrapper' ? createHash('sha256').update(readFileSync(launcher.executable)).digest('hex') : workerdBinarySha256 } };
  return { miniflare, runtimeErrors, receipt, requestOptions, async exportQualified(evidence) {
    if (!process.env.SAFE_FS_EXPORT_WORKER_DIR) return;
    assert.equal(evidence.rows.length, 16);
    assert.deepEqual(evidence.runtimeErrors, []);
    const directory = resolve(process.env.SAFE_FS_EXPORT_WORKER_DIR);
    assert.ok(directory.startsWith(resolve(root, 'out') + '/'));
    await mkdir(directory, { recursive: false });
    const artifacts = [];
    for (const module of modules) {
      const name = relative(outputRoot, module.path);
      await writeFile(resolve(directory, name), module.contents, { flag: 'wx' });
      artifacts.push({ name, type: module.type, bytes: Buffer.byteLength(module.contents), sha256: createHash('sha256').update(module.contents).digest('hex') });
    }
    await writeFile(resolve(directory, 'qualification.json'), JSON.stringify({ ...receipt, compatibilityDate: '2026-09-17',
      compatibilityFlags: [], mainModule: 'main.mjs', artifacts, localCases: evidence.rows.length,
      productionHost: false, deployedCloudflare: false,
      protocol: { method: 'POST', endpoint: '/object-io-781', bodyBytes: 0,
        bindings: { r2: 'SCRATCH', bearer: 'QUALIFICATION_TOKEN', owner: 'QUALIFICATION_OWNER', expiryEpochMs: 'QUALIFICATION_EXPIRES_AT' },
        size: 9437184, chunkBytes: [65536, 262144, 1048576], callerBytes: [65536, 262144, 1048576],
        maxTransferBytes: [65536, 262144, 1048576], workingPages: [1, 4, 16], maxResidentPageBytes: 1048576,
        delayMs: [0, 5], responseContentType: 'application/x-ndjson',
        responseBody: 'bounded {type:chunk,offset,base64} records (decoded <=65536 bytes), followed by one {type:summary,completed:true,canonicalBytes,phases,...} after canonical EOF and all cleanup',
        conformanceEndpoint: '/conformance', errorGateEndpoint: '/unhandled-errors',
        readyEndpoint: '/ready', cleanupEndpoint: '/cleanup', cleanupMaxListPages: 32, cleanupPageObjects: 100,
        cleanupScope: 'Entire SCRATCH bucket; MUST be a new qualification-only bucket independently owner-attested by the deployment driver',
        expiry: 'Benchmarks, readiness and error gates require unexpired credentials within one hour; authenticated cleanup remains allowed after expiry to avoid stranding qualification objects',
        expectedSequentialSha256: evidence.rows[0].stdout.trim().split('\n')[0], expectedPositionedSha256: evidence.rows[0].canonicalHash },
      qualification: 'Local workerd qualification only. Export is not a deployment or authoritative consumer CAS attestation.' }, null, 2) + '\n', { flag: 'wx' });
  } };
}
