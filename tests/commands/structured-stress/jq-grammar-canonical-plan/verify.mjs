import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { root, owned, stress, author, review, digest, read, json, artifact, tree, key } from './common.mjs';

const recording = process.argv.includes('--record');
const finalRecording = process.argv.includes('--record-final');
const manifest = json(`${owned}/patch-manifest-v3.json`);
const rows = json(`${owned}/row-map-final-v3.json`).rows;
const before = new Map(manifest.files.filter(file => file.beforeSnapshot).map(file => [file.path, read(file.beforeSnapshot)]));
const after = new Map(manifest.files.map(file => [file.path, read(file.afterSnapshot)]));
const result = { productImported: false, sourceCertified: false, canonicalApplied: false, checks: [] };
function check(name, detail) { result.checks.push({ name, ...detail }); }
const baseline = json(`${owned}/inputs-before.json`);
for (const [path, hash] of Object.entries(baseline.canonicalBefore)) assert.equal(digest(read(path)), hash, path);
for (const expected of baseline.immutableBefore) assert.deepEqual(tree(expected.path), expected, expected.path);
for (const file of manifest.files) {
  assert.equal(digest(after.get(file.path)), file.afterSha256);
  if (file.beforeSha256 === null) { assert.equal(existsSync(resolve(root, file.path)), false); continue; }
  assert.equal(digest(before.get(file.path)), file.beforeSha256);
  assert.equal(digest(read(file.path)), file.beforeSha256);
  let previous = 0;
  let reconstructed = '';
  for (const edit of file.edits) {
    assert.ok(edit.start >= previous);
    assert.equal(before.get(file.path).slice(edit.start, edit.end), edit.oldText);
    assert.equal(digest(edit.oldText), edit.oldSha256);
    reconstructed += before.get(file.path).slice(previous, edit.start) + edit.newText;
    previous = edit.end;
  }
  reconstructed += before.get(file.path).slice(previous);
  assert.equal(reconstructed, after.get(file.path));
  for (const span of file.preserved) {
    const original = Buffer.from(before.get(file.path)).subarray(span.beforeStartByte, span.beforeStartByte + span.bytes);
    const proposed = Buffer.from(after.get(file.path)).subarray(span.afterStartByte, span.afterStartByte + span.bytes);
    assert.deepEqual(proposed, original);
    assert.equal(digest(original), span.sha256);
  }
}
check('minimal nonoverlapping spans and bytewise untouched regions', { files: manifest.files.length, spans: manifest.files.reduce((sum, file) => sum + file.edits.length, 0), immutableTrees: baseline.immutableBefore.length });
for (const [kind, patchName] of [['native', 'native-v3.patch'], ['host', 'host-conditional-v3.patch']]) {
  const patch = read(`${owned}/${patchName}`);
  assert.equal(digest(patch), manifest.patches[kind]);
  const checked = spawnSync('git', ['apply', '--check', `${owned}/${patchName}`], { cwd: root, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  const pieces = patch.split(/(?=^diff --git )/mu).filter(Boolean);
  const paths = [];
  for (const piece of pieces) {
    const path = piece.match(/^\+\+\+ b\/(.+)$/mu)[1];
    paths.push(path);
    const originalLines = before.has(path) ? before.get(path).slice(0, -1).split('\n') : [];
    const output = [];
    let cursor = 0;
    const lines = piece.slice(0, -1).split('\n');
    for (let index = 0; index < lines.length; index++) {
      const header = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u);
      if (!header) continue;
      const start = Number(header[1]) === 0 ? 0 : Number(header[1]) - 1;
      assert.ok(start >= cursor);
      output.push(...originalLines.slice(cursor, start));
      cursor = start;
      let oldCount = 0;
      let newCount = 0;
      while (index + 1 < lines.length && !lines[index + 1].startsWith('@@ ')) {
        const line = lines[++index];
        if (line[0] === ' ' || line[0] === '-') { assert.equal(originalLines[cursor++], line.slice(1)); oldCount++; }
        if (line[0] === ' ' || line[0] === '+') { output.push(line.slice(1)); newCount++; }
      }
      assert.equal(oldCount, Number(header[2] ?? 1));
      assert.equal(newCount, Number(header[4] ?? 1));
    }
    output.push(...originalLines.slice(cursor));
    assert.equal(`${output.join('\n')}\n`, after.get(path), path);
  }
  assert.deepEqual(paths.sort(), manifest.files.filter(file => file.patch === kind).map(file => file.path).sort());
  check(`${kind} unified patch checks and reconstructs snapshots`, { paths });
}

const require = createRequire(import.meta.url);
const frozen = JSON.parse(after.get(`${stress}/jq-grammar-native-v3.json`));
const byKey = new Map(frozen.vectors.map(vector => [key(vector), vector]));
assert.equal(byKey.size, frozen.vectors.length);
const actualSchedules = [];
class MemoryFileSystem {
  files = {};
  async writeFile(path, bytes) { this.files[path.replace(/^\//u, '')] = Buffer.from(bytes).toString('hex'); }
}
class FsError extends Error { constructor(code) { super(code); this.code = code; } }
class JqError extends Error {}
async function* chunks(input, size = 1) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : input;
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.slice(offset, offset + size);
}
const allVectors = [ ...json(`${stress}/independent-increment/native-vectors.json`).cases, ...json(`${stress}/independent-increment/supplement-vectors.json`).cases ];
const context = vm.createContext({ Buffer, Uint8Array, URL, AbortController, AbortSignal, setTimeout, clearTimeout });
const realmRecord = vm.runInContext('(value) => Object.assign({}, value)', context);
let calls = [];
let assertionCalls = [];
let muted = false;
let commandBehavior;
let outputMutant;
let hostSimulation;
async function simulated(argv, input = 'null', options = {}, overrides = {}) {
  const acquired = !(argv.length === 1 && (argv[0] === 'split' || argv[0] === 'split(","; "g")'));
  const inputKind = typeof input === 'string' ? 'string' : input instanceof Uint8Array ? 'bytes' : 'iterator';
  const parts = [];
  if (acquired) {
    if (typeof input === 'string' || input instanceof Uint8Array) parts.push(Buffer.from(input));
    else for await (const chunk of input) parts.push(Buffer.from(chunk));
  }
  const identity = { argv: [...argv], inputHex: Buffer.concat(parts).toString('hex'), files: overrides.fs?.files ?? {} };
  calls.push({ ...identity, inputKind, acquired, chunksHex: parts.map(part => part.toString('hex')), options, overrideKeys: Object.keys(overrides) });
  const vector = byKey.get(key(identity));
  const expected = vector?.expected ?? { status: 5, stdoutHex: '', stderrHex: Buffer.from('jq: synthetic nonselected control\n').toString('hex') };
  const stdoutBytes = Buffer.from(expected.stdoutHex, 'hex');
  const stderrBytes = Buffer.from(expected.stderrHex, 'hex');
  if (outputMutant && vector?.ids.includes(outputMutant.id)) {
    return realmRecord({ ...expected, stdoutHex: outputMutant.mutantHex, stdout: Buffer.from(outputMutant.mutantHex, 'hex').toString(), stderr: stderrBytes.toString(), exitCode: expected.status, stdoutBytes: Buffer.from(outputMutant.mutantHex, 'hex'), stderrBytes });
  }
  return realmRecord({ ...expected, exitCode: expected.status, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), stdoutBytes, stderrBytes });
}
const wrappedAssert = new Proxy(assert, {
  get(target, property) {
    const member = target[property];
    if (typeof member !== 'function' || property === 'AssertionError') return member;
    return (...args) => { if (muted) { assertionCalls.push([String(property), ...args]); return; } return member(...args); };
  },
  apply(target, receiver, args) { if (muted) { assertionCalls.push(['ok', ...args]); return; } return target(...args); },
});
const modules = new Map();
function load(path, text, registrations = []) {
  const exports = {};
  const code = ts.transpileModule(text.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(resolve(root, path)).href)), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText;
  const restrictedRequire = specifier => {
    if (specifier === 'node:assert/strict') return wrappedAssert;
    if (specifier === 'node:test') return { test(name, options, callback) { registrations.push({ name, options: typeof options === 'function' ? {} : options, callback: callback ?? options }); } };
    if (specifier === 'node:fs') return { readFileSync(path, encoding) {
      const filename = String(path instanceof URL ? path.pathname : path);
      const virtual = after.get(filename.startsWith(root + '/') ? filename.slice(root.length + 1) : filename);
      return virtual === undefined ? readFileSync(path, encoding) : encoding ? virtual : Buffer.from(virtual);
    } };
    if (specifier.startsWith('node:')) return require(specifier);
    if (specifier.includes('jq-grammar-native-v3')) return modules.get('native');
    if (specifier.includes('/src/fs/memory/')) return { MemoryFileSystem };
    if (specifier.includes('/src/contracts/')) return { FsError, toByteSource: input => chunks(input, Buffer.byteLength(input) || 1) };
    if (specifier.endsWith('/src/commands/structured/limits.js')) return { JqError };
    if (specifier.includes('/src/commands/structured/')) return { createStructuredCommands: options => [{ execute: context => commandBehavior(context, options) }] };
    if (specifier === './helpers.js') return { chunks, run: simulated, runWithBytes: simulated };
    if (specifier.endsWith('harness.js')) return {
      execute: async (...args) => { const value = await simulated(...args); return realmRecord({ status: value.status, stdout: value.stdout, stderr: value.stderr }); },
      executeWithBytes: simulated,
      executeBytes: async (...args) => { if (hostSimulation) return hostSimulation(...args); const value = await simulated(...args); return realmRecord({ status: value.status, stdoutHex: value.stdoutHex, stderrHex: value.stderrHex }); },
      allVectors, expectedBytes: vector => { const { status, stdoutHex, stderrHex } = vector.expected; return realmRecord({ status, stdoutHex, stderrHex }); },
    };
    if (specifier === './evidence.js') {
      const evidencePath = `${stress}/split-increment/native.json`;
      assert.equal(digest(readFileSync(resolve(root, evidencePath))), 'cdee2e3a38d929e66d8fdf3917bed62ea46ccff86091de0816128c38176bd8d3');
      return { evidence: json(evidencePath) };
    }
    throw new Error(`No product imports allowed: ${specifier} in ${path}`);
  };
  vm.runInContext(`(function(exports, require) {\n${code}\n})`, context, { filename: path, timeout: 5000 })(exports, restrictedRequire);
  return exports;
}
modules.set('native', load(`${stress}/jq-grammar-native-v3.ts`, after.get(`${stress}/jq-grammar-native-v3.ts`)));
const nativeAssertions = modules.get('native');
const registrationCache = new Map();
for (const row of rows) {
  if (!registrationCache.has(row.path)) {
    const oldTests = [];
    const newTests = [];
    load(row.path, before.get(row.path), oldTests);
    load(row.path, after.get(row.path), newTests);
    assert.equal(newTests.length, oldTests.length);
    registrationCache.set(row.path, { oldTests, newTests });
  }
  const { oldTests, newTests } = registrationCache.get(row.path);
  const oldTest = oldTests.filter(test => test.name === row.oldTestName);
  const newTest = newTests.filter(test => test.name === row.newTestName);
  assert.equal(oldTest.length, 1, row.oldTestName);
  assert.equal(newTest.length, 1, row.newTestName);
  assert.deepEqual(JSON.parse(JSON.stringify(newTest[0].options)), JSON.parse(JSON.stringify(oldTest[0].options)));
  calls = [];
  muted = true;
  await oldTest[0].callback();
  const oldCalls = calls;
  calls = [];
  muted = false;
  await newTest[0].callback();
  assert.deepEqual(calls, oldCalls, row.oldTestName);
  assert.equal(calls.length, row.schedule.executions, row.oldTestName);
  for (const invocation of calls) assert.ok(row.constituents.some(item => key(item) === key(invocation)), row.oldTestName);
  actualSchedules.push({ number: row.number, oldTestName: row.oldTestName, newTestName: row.newTestName, options: newTest[0].options, calls });
}
assert.equal(actualSchedules.reduce((sum, row) => sum + row.calls.length, 0), 464);
check('actual original/proposed selected callback schedules match', { rows: 29, calls: 464, constituents: 96, uniqueInputKeys: byKey.size, productCalls: 0, method: 'Transpile proposed test callbacks in memory; inject frozen tuples only, compare full invocation/chunk/file schedules. This validates proposal wiring, not product parity.' });

const unrelated = [];
for (const [path, registrations] of registrationCache) {
  const selected = new Set(rows.filter(row => row.path === path).map(row => row.oldTestName));
  for (const oldTest of registrations.oldTests.filter(test => !selected.has(test.name))) {
    const newTest = registrations.newTests.find(test => test.name === oldTest.name);
    assert.ok(newTest, oldTest.name);
    assert.equal(JSON.stringify(newTest.options), JSON.stringify(oldTest.options));
    const sameCallback = oldTest.callback.toString() === newTest.callback.toString();
    if (!sameCallback) {
      assert.ok([`${stress}/raw-input.test.ts`, `${stress}/join.test.ts`, `${stress}/safety.test.ts`, `${stress}/split-increment/command.test.ts`].includes(path));
      muted = true;
      calls = []; assertionCalls = [];
      await oldTest.callback();
      const oldCalls = calls; const oldAssertions = assertionCalls;
      calls = []; assertionCalls = [];
      await newTest.callback();
      assert.deepEqual(calls, oldCalls, oldTest.name);
      assert.deepEqual(assertionCalls, oldAssertions, oldTest.name);
      muted = false;
    }
    unrelated.push({ path, name: oldTest.name, timeoutUnchanged: true, identicalCallback: sameCallback, otherwiseUnchangedSyntheticCallsAndAssertions: !sameCallback });
  }
}
check('unselected registrations and shared-loop branches retained', { tests: unrelated.length, byteIdenticalCallbacks: unrelated.filter(test => test.identicalCallback).length, syntheticTraceChecks: unrelated.filter(test => !test.identicalCallback).length, index20Retained: unrelated.some(test => test.name === 'valid large exponent 20 across chunk boundaries'), split2Retained: unrelated.some(test => test.name === 'split rejects out-of-scope arity: split(","; "g")') });

const mutants = [];
for (const mutant of frozen.byteMutants) {
  const row = rows.find(row => row.constituents.some(item => item.id === mutant.id));
  assert.ok(row);
  const vector = frozen.vectors.find(vector => vector.ids.includes(mutant.id));
  assert.equal(vector.expected.stdoutHex, mutant.expectedHex);
  assert.equal(Buffer.from(mutant.expectedHex, 'hex').toString(), Buffer.from(mutant.mutantHex, 'hex').toString());
  outputMutant = mutant;
  const callback = registrationCache.get(row.path).newTests.find(test => test.name === row.newTestName).callback;
  await assert.rejects(callback(), assert.AssertionError);
  outputMutant = undefined;
  mutants.push({ ...mutant, plannedCanonicalCallbackRejects: true, rawByteAssertionRejects: true });
}
assert.equal(mutants.length, 14);
const byteTests = [];
load(`${stress}/jq-grammar-byte-assertions-v3.test.ts`, after.get(`${stress}/jq-grammar-byte-assertions-v3.test.ts`), byteTests);
for (const test of byteTests) await test.callback();
assert.throws(() => nativeAssertions.nativeExpected(['-nc', '1/0'], undefined), /explicit actual input required/u);
assert.throws(() => nativeAssertions.nativeExpected(['-nc', '1/0'], ''), /missing frozen native input/u);
assert.equal(nativeAssertions.nativeExpected(['-nc', '1/0'], 'null').status, 5);
const duplicateHelper = after.get(`${stress}/jq-grammar-native-v3.ts`).replace('for (const vector of nativeGrammar.vectors)', 'for (const vector of [...nativeGrammar.vectors, nativeGrammar.vectors[0]!])');
assert.throws(() => load(`${stress}/jq-grammar-native-v3.ts`, duplicateHelper), /duplicate frozen native input/u);
check('byte mutation and lookup safeguards', { documentedMutantsRejectedByActualProposedCallbacks: 14, proposedHelperTests: byteTests.length, missingAndDuplicateRejected: true, undefinedNotConflatedWithDefault: true });

const helperChecks = [];
for (const path of [`${stress}/harness.ts`, 'tests/commands/structured/helpers.ts']) {
  const helper = load(path, after.get(path));
  const legacyName = path.endsWith('/harness.ts') ? 'execute' : 'run';
  const rawName = `${legacyName}WithBytes`;
  let observed;
  commandBehavior = async (context, options) => {
    observed = { context, options };
    const stdout = Buffer.from([0xef, 0xbf, 0xbd]);
    const stderr = Buffer.from([0x80]);
    await context.stdout.write(stdout); stdout.fill(0);
    await context.stderr.write(stderr); stderr.fill(0);
    return { exitCode: 3, diagnosticToken: 'preserved' };
  };
  const raw = await helper[rawName](['filter']);
  assert.equal(raw.stdoutBytes.toString('hex'), 'efbfbd');
  assert.equal(raw.stderrBytes.toString('hex'), '80');
  assert.equal(raw.stdout, '\uFFFD'); assert.equal(raw.stderr, '\uFFFD');
  const defaultChunks = [];
  for await (const chunk of observed.context.stdin) defaultChunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(defaultChunks).toString(), 'null');
  const legacy = await helper[legacyName](['filter']);
  assert.equal('stdoutBytes' in legacy, false); assert.equal('stderrBytes' in legacy, false);
  if (legacyName === 'execute') assert.deepEqual(Object.keys(legacy).sort(), ['status', 'stderr', 'stdout']);
  else { assert.equal(legacy.diagnosticToken, 'preserved'); assert.equal(legacy.context, observed.context); }
  const signal = new AbortController().signal;
  const fs = new MemoryFileSystem();
  const stdin = chunks('overridden');
  const env = { EXACT: 'yes' };
  const forwarded = [];
  await helper[rawName](['filter'], 'input', { limits: { maxSteps: 123 } }, { fs, cwd: '/kept', env, signal, stdin, stdout: { async write(bytes) { forwarded.push(Buffer.from(bytes)); } } });
  assert.equal(observed.context.signal, signal); assert.equal(observed.context.fs, fs); assert.equal(observed.context.env, env); assert.equal(observed.context.stdin, stdin); assert.equal(observed.context.cwd, '/kept');
  assert.equal(observed.options.limits.maxSteps, 123); assert.equal(forwarded.length, 1);
  if (legacyName === 'execute') {
    for (const stream of ['stdout', 'stderr']) {
      commandBehavior = async context => { await context[stream].write(Buffer.alloc(128 * 1024 + 1)); return { exitCode: 0 }; };
      await assert.rejects(helper[rawName](['filter']), /independent capture cap/u);
    }
  }
  helperChecks.push({ path, copiedBeforeBufferReuse: true, legacyFieldsPreserved: true, actualDefaultNull: true, overridesAndOptionsPreserved: true, originalCaptureCapPreserved: legacyName === 'execute' ? 128 * 1024 : 'original helper has no added cap' });
}
check('proposed test-only helpers against injected command stub', { helpers: helperChecks });

const hostPath = `${stress}/jq-42-author-20260827/safety.test.ts`;
const hostTests = [];
load(hostPath, after.get(hostPath), hostTests);
const hostIdentity = hostTests.filter(test => test.name.startsWith('host stdout failure is never a recoverable filter error:'));
assert.equal(hostIdentity.length, 2);
const simulateHost = mode => async (argv, input, options, overrides) => {
  const iterator = input[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    try { await overrides.stdout.write(first.value); }
    catch (error) {
      if (mode === 'convert-to-status') return { status: 5, stdoutHex: '', stderrHex: '' };
      if (mode === 'diagnostic-write') await overrides.stderr.write(Buffer.from('unexpected diagnostic\n'));
      if (mode === 'extra-read') await iterator.next();
      throw error;
    }
  } finally { await iterator.return(); }
};
hostSimulation = simulateHost('identity');
for (const test of hostIdentity) await test.callback();
const hostJqError = hostIdentity.find(test => test.name.endsWith('host sink failure'));
for (const mode of ['convert-to-status', 'diagnostic-write', 'extra-read']) {
  hostSimulation = simulateHost(mode);
  await assert.rejects(hostJqError.callback(), assert.AssertionError);
}
hostSimulation = undefined;
check('conditional host patch wiring only, not contract approval', { jqErrorRows: 1, unchangedEpipeControl: 1, identityStubPasses: true, rejectedStubMutations: ['convert-to-status', 'diagnostic-write', 'extra-read'], nativeParity: false, sourceContractDecisionPending: true });

const staticStatements = [];
for (const file of manifest.files.filter(file => file.beforeSnapshot && file.path.endsWith('.test.ts'))) {
  const source = ts.createSourceFile(file.path, before.get(file.path), ts.ScriptTarget.ES2023, true);
  for (const statement of source.statements) {
    const start = statement.getStart(source);
    const end = statement.getEnd();
    if (file.edits.some(edit => edit.start < end && edit.end > start)) continue;
    const shift = file.edits.filter(edit => edit.end <= start).reduce((sum, edit) => sum + edit.newText.length - edit.oldText.length, 0);
    const original = before.get(file.path).slice(start, end);
    const proposed = after.get(file.path).slice(start + shift, end + shift);
    assert.equal(proposed, original);
    staticStatements.push({ path: file.path, startByte: Buffer.byteLength(before.get(file.path).slice(0, start)), bytes: Buffer.byteLength(original), sha256: digest(original), identical: true });
  }
}
const safetyPath = `${stress}/safety.test.ts`;
const tailStart = before.get(safetyPath).indexOf('const preflight:');
assert.ok(tailStart > 0);
const safetyTail = before.get(safetyPath).slice(tailStart);
assert.equal(after.get(safetyPath).slice(after.get(safetyPath).indexOf('const preflight:')), safetyTail);
check('bytewise static unrelated statements and complete safety suffix', { untouchedTopLevelStatements: staticStatements.length, safetySuffixBytes: Buffer.byteLength(safetyTail), safetySuffixSha256: digest(safetyTail), allIdentical: true });

const compilerOptions = ts.convertCompilerOptionsFromJson(json('tsconfig.json').compilerOptions, root).options;
const host = ts.createCompilerHost({ ...compilerOptions, noEmit: true });
const originalRead = host.readFile.bind(host);
host.readFile = path => after.get(path.startsWith(root + '/') ? path.slice(root.length + 1) : path) ?? originalRead(path);
const originalExists = host.fileExists.bind(host);
host.fileExists = path => after.has(path.startsWith(root + '/') ? path.slice(root.length + 1) : path) || originalExists(path);
host.getSourceFile = (filename, languageVersion) => { const text = host.readFile(filename); return text === undefined ? undefined : ts.createSourceFile(filename, text, languageVersion); };
const program = ts.createProgram(manifest.files.filter(file => file.path.endsWith('.ts')).map(file => resolve(root, file.path)), { ...compilerOptions, noEmit: true }, host);
const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({ path: diagnostic.file?.fileName.replace(root + '/', ''), start: diagnostic.start, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') }));
const ownedDiagnostics = diagnostics.filter(diagnostic => after.has(diagnostic.path));
if (ownedDiagnostics.length) console.error(JSON.stringify(ownedDiagnostics, null, 2));
assert.equal(ownedDiagnostics.length, 0);
check('in-memory proposed-files typecheck', { proposedDiagnostics: ownedDiagnostics, transitiveDiagnostics: diagnostics, noEmit: true, productImported: false, warning: 'Type analysis of reachable declarations/source only; not runtime or source acceptance.' });

for (const [path, hash] of Object.entries(baseline.canonicalBefore)) assert.equal(digest(read(path)), hash);
for (const expected of baseline.immutableBefore) assert.deepEqual(tree(expected.path), expected);
result.summary = { selectedRows: 29, selectedSchedules: 464, hostConditionalRows: 1, mutantsRejected: 14, helpersChecked: 2, unselectedTests: unrelated.length, noProductImport: true, literalFileChecksUnavailable: 2 };
if (recording) {
  artifact('verification-v3.json', result);
  artifact('invocation-schedules-v3.json', actualSchedules);
  artifact('unrelated-preservation-v3.json', unrelated);
  artifact('mutation-checks-v3.json', mutants);
  artifact('static-preservation-v3.json', staticStatements);
  artifact('inputs-after.json', { immutableAfter: baseline.immutableBefore.map(expected => tree(expected.path)), canonicalAfter: Object.fromEntries(Object.keys(baseline.canonicalBefore).map(path => [path, digest(read(path))])) });
}
if (finalRecording) {
  assert.deepEqual(json(`${owned}/invocation-schedules-v3.json`), JSON.parse(JSON.stringify(actualSchedules)));
  assert.deepEqual(json(`${owned}/mutation-checks-v3.json`), mutants);
  assert.deepEqual(json(`${owned}/static-preservation-v3.json`), staticStatements);
  artifact('verification-v3-final.json', { ...result, supersedes: 'verification-v3.json omitted 69 unchanged split-native registrations via an empty fixture stub; final validation uses the actual immutable 69-case fixture. Prior artifact retained, not overwritten.' });
  artifact('unrelated-preservation-v3-final.json', unrelated);
}
console.log(JSON.stringify(result.summary));
