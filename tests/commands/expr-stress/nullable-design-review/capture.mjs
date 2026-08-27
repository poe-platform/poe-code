import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, type, release, arch } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { instrument, prototype, replaceOnce } from './prototype.mjs';
import { probe, traceNative } from './native-trace.mjs';

const root = '/Users/kjopek/Workspace/safe-bash';
const owned = dirname(fileURLToPath(import.meta.url));
const candidate = '27a7793526830768484885afba5832bf8bb248b5';
const cohortPath = 'tests/commands/expr-stress/extension-review/after-abort-fix/replay/supplement-27a77935/nullable-separate-cohort.json';
const nativeRoot = join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv.length !== 3 || !/^[a-z][a-z0-9-]*$/.test(process.argv[2])) throw new Error('usage: node capture.mjs UNIQUE-CAPTURE-NAME');
const output = join(owned, process.argv[2]);
await mkdir(output);
const temporary = await mkdtemp(join(tmpdir(), 'expr-nullable-design-'));
let activeChildren = 0, activeWorkers = 0;
const commands = [];
const started = new Date().toISOString();
async function save(name, value) { await writeFile(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function child(binary, argv, cwd = temporary) {
  activeChildren++;
  const start = performance.now();
  const result = await new Promise(resolveResult => {
    const process = spawn(binary, argv, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), failure = null, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; process.kill('SIGKILL'); }, 2000);
    for (const [stream, append] of [[process.stdout, bytes => { stdout = Buffer.concat([stdout, bytes]); }], [process.stderr, bytes => { stderr = Buffer.concat([stderr, bytes]); }]]) {
      stream.on('data', bytes => { append(bytes); if (stdout.length + stderr.length > 65536) { failure = 'output cap'; process.kill('SIGKILL'); } });
    }
    process.on('error', error => { failure = error.message; });
    process.on('close', (status, signal) => { clearTimeout(timer); resolveResult({ status, signal, failure, timedOut, stdout: stdout.toString(), stderr: stderr.toString(), stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64') }); });
  });
  activeChildren--;
  commands.push({ binary, argv, cwd, elapsedMs: performance.now() - start, ...result });
  return result;
}
async function git(path) {
  const result = await child('/usr/bin/git', ['show', `${candidate}:${path}`], root);
  assert.equal(result.status, 0); assert.equal(result.timedOut, false);
  return result.stdout;
}
async function fingerprint(paths) {
  const entries = await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(root, path)))]));
  return Object.fromEntries(entries);
}
const trackedInputs = ['src/commands/expr/bre-worker.ts', 'src/commands/regex-execution/protocol.ts', cohortPath, 'tests/commands/expr-stress/nullable-capture-review/manifest.json', ...['src/expr', 'lib/libcoreutils.a', 'lib/regexec.c', 'lib/regex.c', 'lib/regex_internal.c', 'lib/regex_internal.h', 'lib/regcomp.c', 'lib/config.h', 'lib/regex.h'].map(path => `tests/commands/metadata-stress/.oracle/coreutils-9.7/${path}`)];
let before;
try {
  before = await fingerprint(trackedInputs);
  const driverHashes = Object.fromEntries(await Promise.all(['capture.mjs', 'prototype.mjs', 'native-trace.mjs'].map(async path => [path, hash(await readFile(join(owned, path)))])));
  const originalBytes = await readFile(join(root, cohortPath));
  const cohort = JSON.parse(originalBytes);
  assert.equal(cohort.candidate, candidate);
  assert.equal(cohort.rows.length, 8);
  await save('original-eight.json', originalBytes.toString());
  const cases = cohort.rows.map(row => ({ id: row.id, argv: row.argv, original: true }));
  for (const [id, subject, pattern] of [
    ['end-anchor', 'aaa', '\\(a*\\)*\\1$'],
    ['literal-suffix', 'aaab', '\\(a*\\)*\\1b'],
    ['mandatory-a', 'a', '\\(a*\\)\\{2\\}\\1'],
    ['mandatory-aa', 'aa', '\\(a*\\)\\{2\\}\\1'],
    ['mandatory-aaa', 'aaa', '\\(a*\\)\\{2\\}\\1'],
    ['bounded-aa', 'aa', '\\(a*\\)\\{1,3\\}\\1'],
    ['bounded-aaa', 'aaa', '\\(a*\\)\\{1,3\\}\\1'],
    ['unmatched-closed', '', '\\(a\\)*\\1'],
    ['required-empty', '', '\\(a*\\)\\1'],
    ['open-backref', 'a', '\\(a\\1\\)'],
    ['newline-anchor', 'a\n', '\\(a\\)$'],
    ['nested-history', 'aaa', '\\(\\(a*\\)*\\)\\2'],
    ['alternation-longest', 'aaa', '\\(a\\|aa\\)a*'],
    ['finite-optional', 'aa', '\\(a*\\)\\{0,2\\}\\1'],
    ['nested-stale-backref', 'abab', '\\(a\\(b\\)*\\)*\\2'],
    ['mandatory-no-reference', 'aaa', '\\(a*\\)\\{2\\}'],
  ]) cases.push({ id, argv: ['+', subject, ':', pattern], original: false });
  await save('cases.json', cases);
  const expr = join(nativeRoot, 'src/expr');
  assert.equal(before['tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr'], cohort.nativeIdentity.sha256);
  const version = await child(expr, ['--version']); assert.match(version.stdout, /^expr \(GNU coreutils\) 9\.7\n/);
  await writeFile(join(temporary, 'probe.c'), probe, { flag: 'wx' });
  const archive = join(nativeRoot, 'lib/libcoreutils.a');
  const compileArgs = ['-I', nativeRoot, '-I', join(nativeRoot, 'lib'), join(temporary, 'probe.c')];
  const compile = await child('/usr/bin/clang', [...compileArgs, archive, '-o', join(temporary, 'registers')]);
  assert.equal(compile.status, 0, compile.stderr);
  const regexec = await readFile(join(nativeRoot, 'lib/regexec.c'), 'utf8');
  const regex = await readFile(join(nativeRoot, 'lib/regex.c'), 'utf8');
  await writeFile(join(temporary, 'regexec-trace.c'), traceNative(regexec), { flag: 'wx' });
  await writeFile(join(temporary, 'regex-trace.c'), replaceOnce(regex, '#include "regexec.c"', '#include "regexec-trace.c"'), { flag: 'wx' });
  const compileTrace = await child('/usr/bin/clang', [...compileArgs, '-include', 'config.h', '-include', 'stdio.h', join(temporary, 'regex-trace.c'), archive, '-o', join(temporary, 'registers-trace')]);
  assert.equal(compileTrace.status, 0, compileTrace.stderr);
  const native = [];
  for (const specimen of cases) {
    const tuple = await child(expr, specimen.argv);
    const registers = await child(join(temporary, 'registers'), [specimen.argv[1], specimen.argv[3]]);
    const trace = await child(join(temporary, 'registers-trace'), [specimen.argv[1], specimen.argv[3]]);
    assert.equal(tuple.timedOut || registers.timedOut || trace.timedOut, false);
    assert.equal(registers.stdout, trace.stdout, `instrumented native mismatch ${specimen.id}`);
    native.push({ id: specimen.id, tuple, registers, trace });
    if (specimen.original) {
      const expected = cohort.rows.find(row => row.id === specimen.id).expected;
      for (const key of ['status', 'stdoutBase64', 'stderrBase64']) assert.equal(tuple[key], expected[key]);
    }
  }
  await save('native.json', native);
  const source = await git('src/commands/expr/bre-worker.ts');
  const protocol = await git('src/commands/regex-execution/protocol.ts');
  const require = createRequire(join(root, 'package.json'));
  const ts = require('typescript');
  const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await writeFile(join(temporary, 'protocol.mjs'), transpile(protocol), { flag: 'wx' });
  const unguarded = replaceOnce(source, '  validateCaptureRepetition(tree, work);', '');
  const variants = {
    candidate: instrument(source),
    unguarded: instrument(unguarded),
    exactMandatoryOnly: instrument(replaceOnce(source, 'node.maximum > 1 && nullable(node.child)', 'node.maximum > 1 && node.minimum !== node.maximum && nullable(node.child)')),
    repeatFrames: prototype(source),
  };
  const limits = { maxPatternBytes: 8192, maxSubjectBytes: 65536, maxNodes: 4096, maxDepth: 64, maxSteps: 8000000, maxStates: 16384, maxAllocatedUnits: 1000000 };
  const measurements = {};
  const workerSource = `const { parentPort, workerData } = require('node:worker_threads');
  import(workerData.module).then(({matchExpr}) => {
    const outputs = [];
    for (const specimen of workerData.cases) {
      globalThis.diagnosticTrace = []; globalThis.diagnosticInstructions = [];
      const started = performance.now();
      try { const result = matchExpr({ kind: 'expr-match', profile: 'byte', limits: {...workerData.limits, ...specimen.limits}, pattern: Buffer.from(specimen.argv[3]) }, Buffer.from(specimen.argv[1]));
        outputs.push({ id: specimen.id, result, elapsedMs: performance.now()-started, trace: globalThis.diagnosticTrace, instructions: globalThis.diagnosticInstructions });
      } catch(error) { outputs.push({id: specimen.id, error: {category: error.category, message: error.message}, elapsedMs: performance.now()-started, trace: globalThis.diagnosticTrace, instructions: globalThis.diagnosticInstructions }); }
    }
    const js = ['', 'a', 'aa', 'aaa'].map(subject => { const match = /^(a*)*\\1/d.exec(subject); return {subject, match: match ? Array.from(match, value => value ?? null) : null, indices: match?.indices}; });
    parentPort.postMessage({outputs, js});
  });`;
  const limitCases = ['maxSteps', 'maxStates', 'maxNodes', 'maxAllocatedUnits'].map(name => ({ id: `limit-${name}`, argv: ['+', 'aaa', ':', '\\(a*\\)*\\1'], limits: { [name]: 1 } }));
  for (const [name, text] of Object.entries(variants)) {
    const module = transpile(replaceOnce(text, '../regex-execution/protocol.js', './protocol.mjs'));
    await writeFile(join(temporary, `${name}.mjs`), module, { flag: 'wx' });
    activeWorkers++;
    const worker = new Worker(workerSource, { eval: true, workerData: { module: pathToFileURL(join(temporary, `${name}.mjs`)).href, cases: [...cases, ...limitCases], limits }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
    const start = performance.now();
    let timer;
    try {
      const results = await new Promise((resolveResult, reject) => {
        timer = setTimeout(() => reject(new Error('diagnostic worker 2s deadline')), 2000);
        worker.once('message', resolveResult); worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
      });
      measurements[name] = { noncandidate: name !== 'candidate', sourceHash: hash(text), moduleHash: hash(module), jobElapsedMs: performance.now() - start, ...results };
      await save(`${name}.json`, measurements[name]);
    } finally { clearTimeout(timer); await worker.terminate(); activeWorkers--; }
  }
  const summarize = entry => entry.error ? { error: entry.error } : { overall: entry.result.overall, capture: entry.result.capture, matched: entry.result.matched, hasCapture: entry.result.hasCapture, steps: entry.result.steps, ...entry.result.diagnostics, elapsedMs: entry.elapsedMs };
  await save('summary.json', cases.map(specimen => ({ ...specimen, native: native.find(row => row.id === specimen.id).tuple, registers: JSON.parse(native.find(row => row.id === specimen.id).registers.stdout || 'null'), variants: Object.fromEntries(Object.entries(measurements).map(([name, result]) => [name, summarize(result.outputs.find(row => row.id === specimen.id))])) })));
  const after = await fingerprint(trackedInputs);
  assert.deepEqual(after, before);
  await save('provenance.json', { started, ended: new Date().toISOString(), candidate, host: { type: type(), release: release(), arch: arch(), node: process.version }, environment, limits, typescript: ts.version, typescriptHash: hash(await readFile(require.resolve('typescript'))), gitInputs: { source: hash(source), protocol: hash(protocol) }, driverHashes, before, after, temporary, version, note: 'Exact selected-path before/after integrity only, not append-proof repository validation. Native trace is a locally rebuilt diagnostic, NOT the pinned oracle. All native expected tuples remain pinned GNU9.7/Darwin. Candidate instrumented engine is not a public Shell replay. Repeat-frame prototype and finite relaxation are noncandidate.' });
} catch (error) {
  await save('failure.json', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  await save('commands.json', commands);
  assert.equal(activeChildren, 0); assert.equal(activeWorkers, 0);
  await rm(temporary, { recursive: true, force: true });
  await save('cleanup.json', { activeChildren, activeWorkers, removed: temporary, exists: await stat(temporary).then(() => true, () => false), ended: new Date().toISOString() });
}
