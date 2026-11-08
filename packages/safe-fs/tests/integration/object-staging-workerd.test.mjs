import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import { admitPublicStagingPackages } from './object-staging-public-admission.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executorRoot = process.env.SAFE_FS_EXECUTOR_ROOT;
const revision = process.env.SAFE_FS_EXECUTOR_REVISION;
const runtimeRoot = process.env.SAFE_FS_PYODIDE_ROOT;
const tooling = process.env.SAFE_FS_WORKERD_ROOT;
const outputRoot = process.env.TMPDIR;
const consumerRoot = process.env.SAFE_FS_PUBLIC_CONSUMER_ROOT && resolve(process.env.SAFE_FS_PUBLIC_CONSUMER_ROOT);
assert.ok(runtimeRoot && tooling && outputRoot, 'Set SAFE_FS_PYODIDE_ROOT, SAFE_FS_WORKERD_ROOT and TMPDIR');
assert.ok(resolve(outputRoot).startsWith(resolve(root, 'out') + '/'));
let frozen;
let publicAdmission;
if (consumerRoot) {
  assert.ok(consumerRoot.startsWith(resolve(root, 'out') + '/'), 'Public consumer must be installed under this checkout out/');
  assert.ok(!executorRoot && !revision && !process.env.SAFE_FS_STAGING_REVISION, 'Public mode forbids source selections');
  assert.ok(process.env.SAFE_FS_PUBLIC_ADMISSION, 'Public mode requires SAFE_FS_PUBLIC_ADMISSION');
  publicAdmission = admitPublicStagingPackages({ consumerRoot, admissionPath: process.env.SAFE_FS_PUBLIC_ADMISSION });
} else {
  assert.ok(executorRoot && revision, 'Frozen mode requires SAFE_FS_EXECUTOR_ROOT and SAFE_FS_EXECUTOR_REVISION');
  frozen = execFileSync('git', ['-C', executorRoot, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
}
function source(path) {
  assert.ok(!consumerRoot, 'Git/source access is forbidden in public mode');
  return execFileSync('git', ['-C', executorRoot, 'show', `${frozen}:${path}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}
for (const path of consumerRoot ? [] : ['packages/safe-bash/package.json', 'packages/safe-fs/package.json']) {
  assert.equal(readFileSync(resolve(executorRoot, path), 'utf8'), source(path), 'Module resolution metadata must match the frozen revision');
}
const publicInputs = new Map();
function verifyPublicInputs(inputs) {
  for (const input of Object.keys(inputs)) {
    if (input === 'python-static-assets:assets' || input === '<stdin>') continue;
    const filename = resolve(consumerRoot, input);
    if (filename === fileURLToPath(new URL('./object-staging-workerd.worker.mjs', import.meta.url))
      || filename === fileURLToPath(new URL('./object-staging-workerd.fixture.mjs', import.meta.url))
      || filename.startsWith(resolve(runtimeRoot) + '/')) continue;
    assert.ok(filename.startsWith(resolve(consumerRoot, 'node_modules') + '/'), `Public mode rejected non-installed input: ${filename}`);
    const digest = createHash('sha256').update(readFileSync(filename)).digest('hex');
    if (filename.includes('/@poe-platform/')) assert.equal(digest, publicAdmission.files.get(filename), 'Unadmitted public package input');
    publicInputs.set(relative(consumerRoot, filename), digest);
  }
}
const require = createRequire(resolve(tooling, 'package.json'));
assert.equal(require('miniflare/package.json').version, '5.20260917.0-alpha');
assert.equal(require('workerd/package.json').version, '1.20260917.1');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
let generatorCode;
if (consumerRoot) {
  const generated = await build({ absWorkingDir: consumerRoot,
    stdin: { contents: "export { createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult } from '@poe-platform/safe-bash/commands/python';", resolveDir: consumerRoot },
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', conditions: ['workerd', 'browser'] });
  verifyPublicInputs(generated.metafile.inputs);
  generatorCode = generated.outputFiles[0].text;
} else {
  generatorCode = (await transform(source('packages/safe-bash/src/commands/python/jspi-trampoline.ts'), { loader: 'ts', format: 'esm' })).code;
}
const generators = await import(`data:text/javascript;base64,${Buffer.from(generatorCode).toString('base64')}`);
const manifest = {
  'pyodide.mjs': '69e3f6ccec3e14b465df60be577ca62f536251406b9a00cce019eac5252a2495',
  'pyodide.asm.mjs': '2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7',
  'pyodide.asm.wasm': '3a0a00dfeaa348ac20f9ef09904233d32d33f644339662d4af368f8a2010f37a',
  'python_stdlib.zip': '80c5be6babfe03297069703410c3c29404dcf2525d2b128746bae5536f94831f',
  'pyodide-lock.json': '3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4',
};
const files = Object.fromEntries(Object.entries(manifest).map(([name, digest]) => {
  const bytes = readFileSync(resolve(runtimeRoot, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  return [name, bytes];
}));
function embeddedModule(bytes, select) {
  const ast = ts.createSourceFile('pinned.mjs', bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const selected = [];
  function visit(node) {
    const value = select(node);
    if (value) selected.push(value);
    ts.forEachChild(node, visit);
  }
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

test(`${consumerRoot ? 'installed public' : 'frozen'} workerd executor performs large native writes through R2 staging`, { timeout: 240000 }, async context => {
  const injection = `
import main from 'main.wasm';
import helper from 'helper.wasm';
import ccall from 'ccall.wasm';
import empty from 'empty.wasm';
import stdlib from 'stdlib.bin';
import { createPythonJspiAssets } from ${JSON.stringify(consumerRoot ? '@poe-platform/safe-bash/commands/python' : resolve(executorRoot, 'packages/safe-bash/src/commands/python/jspi-assets.ts'))};
const assets = createPythonJspiAssets({ main, stdlib: new Uint8Array(stdlib), modules: [
 { module: helper, bytes: new Uint8Array(${JSON.stringify(Array.from(helper))}) },
 { module: ccall, bytes: new Uint8Array(${JSON.stringify(Array.from(ccall))}) },
 { module: empty, bytes: new Uint8Array(${JSON.stringify(Array.from(empty))}) },
] });
const { WebAssembly, fetch, location } = assets;
export { WebAssembly, fetch, location };
`;
  const stagingRevision = !consumerRoot && process.env.SAFE_FS_STAGING_REVISION && execFileSync('git',
    ['-C', root, 'rev-parse', '--verify', `${process.env.SAFE_FS_STAGING_REVISION}^{commit}`], { encoding: 'utf8' }).trim();
  const candidate = consumerRoot ? undefined : stagingRevision
    ? execFileSync('git', ['-C', root, 'show', `${stagingRevision}:packages/safe-fs/src/fs/object-publication/index.ts`], { encoding: 'utf8' })
    : readFileSync(resolve(root, 'packages/safe-fs/src/fs/object-publication/index.ts'), 'utf8');
  const bundle = await build({
    ...(consumerRoot ? { absWorkingDir: consumerRoot, metafile: true } : {}),
    entryPoints: [fileURLToPath(new URL('./object-staging-workerd.worker.mjs', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', conditions: ['workerd', 'browser'],
    external: ['main.wasm', 'helper.wasm', 'ccall.wasm', 'empty.wasm', 'trampoline.wasm', 'native-call.wasm', 'stat-result.wasm', 'stdlib.bin', 'node:*', 'ws'],
    define: { 'globalThis.process': 'undefined', process: 'undefined' },
    alias: {
      'pinned-pyodide-loader': resolve(runtimeRoot, 'pyodide.mjs'),
      'pinned-pyodide-module': resolve(runtimeRoot, 'pyodide.asm.mjs'),
      'pinned-pyodide-lock': resolve(runtimeRoot, 'pyodide-lock.json'),
      ...(consumerRoot ? {
        'qualified-shell': '@poe-platform/safe-bash',
        'qualified-python': '@poe-platform/safe-bash/commands/python',
        '@poe-code/safe-fs/core': '@poe-platform/safe-fs/core',
      } : {
        'qualified-shell': resolve(executorRoot, 'packages/safe-bash/src/shell/shell.ts'),
        'qualified-python': resolve(executorRoot, 'packages/safe-bash/src/commands/python/index.ts'),
        '@poe-code/safe-fs/core': resolve(executorRoot, 'packages/safe-fs/src/core.ts'),
        '@noble/hashes/sha2.js': resolve(root, 'node_modules/@noble/hashes/sha2.js'),
      }),
    },
    inject: ['python-static-assets'], plugins: [{ name: 'frozen-python-and-candidate-staging', setup(plugin) {
      plugin.onResolve({ filter: /^python-static-assets$/ }, () => ({ path: 'assets', namespace: 'python-static-assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'python-static-assets' }, () => ({ contents: injection, loader: 'js', resolveDir: consumerRoot ?? root }));
      if (!consumerRoot) plugin.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        const path = relative(executorRoot, args.path);
        if (!path.startsWith('packages/safe-fs/src/') && !path.startsWith('packages/safe-bash/src/')) return;
        return { contents: path === 'packages/safe-fs/src/fs/object-publication/index.ts' ? candidate : source(path),
          loader: path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(args.path) };
      });
    } }],
  });
  if (consumerRoot) verifyPublicInputs(bundle.metafile.inputs);
  const qualification = consumerRoot ? { ...publicAdmission.evidence,
    inputCount: publicInputs.size,
    installedInputsSha256: createHash('sha256').update(JSON.stringify([...publicInputs].sort())).digest('hex'),
  } : { mode: 'frozen-source', frozenExecutor: frozen, stagingRevision,
    candidateStagingSha256: createHash('sha256').update(candidate).digest('hex') };
  const modules = [
    { type: 'ESModule', path: resolve(outputRoot, 'main.mjs'), contents: bundle.outputFiles[0].text },
    ...[['main.wasm', files['pyodide.asm.wasm']], ['helper.wasm', helper], ['ccall.wasm', ccall], ['empty.wasm', empty],
      ['trampoline.wasm', generators.createPythonJspiTrampoline()], ['native-call.wasm', generators.createPythonJspiNativeCall()],
      ['stat-result.wasm', generators.createPythonJspiStatResult()]]
      .map(([name, contents]) => ({ type: 'CompiledWasm', path: resolve(outputRoot, name), contents })),
    { type: 'Data', path: resolve(outputRoot, 'stdlib.bin'), contents: files['python_stdlib.zip'] },
  ];
  const token = 'local-fixture-only-not-a-deployment-secret';
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-09-17', cf: false,
    r2Buckets: ['SCRATCH'], bindings: { QUALIFICATION_TOKEN: token, QUALIFICATION_EXPIRES_AT: String(Date.now() + 600000) } }));
  let passed = 0;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await runtime.dispatchFetch('http://fixture/staging?size=9437184&profile=immediate', { method: 'POST' })).status, 401);
    assert.equal((await runtime.dispatchFetch('http://fixture/staging?size=9437184&profile=immediate', { headers })).status, 405);
    for (const query of ['size=104857601&profile=immediate', 'size=9437184&profile=other', 'size=9437184&profile=immediate&extra=1']) {
      assert.equal((await runtime.dispatchFetch(`http://fixture/staging?${query}`, { method: 'POST', headers })).status, 400);
    }
    assert.equal((await runtime.dispatchFetch('http://fixture/staging?size=9437184&profile=immediate', { method: 'POST', headers, body: 'x' })).status, 400);
    const expired = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-09-17', cf: false,
      r2Buckets: ['SCRATCH'], bindings: { QUALIFICATION_TOKEN: token, QUALIFICATION_EXPIRES_AT: '1' } }));
    try {
      assert.equal((await expired.dispatchFetch('http://fixture/staging?size=9437184&profile=immediate', { method: 'POST', headers })).status, 410);
    } finally { await expired.dispose(); }
    for (const size of [9 * 1024 * 1024, 100 * 1024 * 1024]) {
      for (const profile of ['immediate', 'delayed']) {
        await context.test(`${profile}: ${size} bytes with one 64 KiB page`, async child => {
          const response = await runtime.dispatchFetch(`http://fixture/staging?size=${size}&profile=${profile}&spill=${process.env.SAFE_FS_STAGING_DISABLED === '1' ? '0' : '1'}`, { method: 'POST', headers });
          const text = await response.text();
          assert.equal(response.status, 200, text);
          const result = JSON.parse(text);
          assert.equal(result.exitCode, 0, JSON.stringify(result));
          const expected = createHash('sha256');
          const block = Uint8Array.from({ length: 65536 }, (_, index) => index % 256);
          for (let offset = 0; offset < size; offset += block.length) expected.update(block);
          assert.equal(result.stdout.trim(), expected.digest('hex'));
          assert.equal(result.size, size);
          for (const field of ['stageWriteBytes', 'stageReadBytes', 'publishedBytes']) assert.equal(result[field], size, field);
          assert.equal(result.publications, 2);
          assert.equal(result.created, 1);
          assert.equal(result.closed, 1);
          assert.equal(result.retired, 1);
          assert.equal(result.acquired, result.released);
          assert.equal(result.activeWrites, 0);
          assert.equal(result.peakWrites, 1);
          assert.equal(result.largestChunk, 65536);
          passed++;
          child.diagnostic(JSON.stringify({ ...qualification, profile, ...result }));
        });
      }
    }
  } finally { await runtime.dispose(); }
  if (process.env.SAFE_FS_EXPORT_WORKER_DIR) {
    assert.equal(passed, 4, 'Do not export an unqualified artifact');
    const directory = resolve(process.env.SAFE_FS_EXPORT_WORKER_DIR);
    assert.ok(directory.startsWith(resolve(root, 'out') + '/'));
    await mkdir(directory);
    const artifacts = [];
    for (const module of modules) {
      const name = relative(outputRoot, module.path);
      await writeFile(resolve(directory, name), module.contents);
      artifacts.push({ name, type: module.type, bytes: Buffer.byteLength(module.contents),
        sha256: createHash('sha256').update(module.contents).digest('hex') });
    }
    await writeFile(resolve(directory, 'qualification.json'), JSON.stringify({ ...qualification,
      compatibilityDate: '2026-09-17', miniflare: '5.20260917.0-alpha', workerd: '1.20260917.1',
      cases: passed, productionHost: false, deployedCloudflare: false, artifacts }, null, 2) + '\n');
  }
});
