import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import threads from 'node:worker_threads';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { owned, hash } from './prepare.mjs';

const { installed, source } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const base = pathToFileURL(realpathSync(installed) + '/').href;
const design = join(source, 'tests/commands/expr-stress/named-profile-design-20260827');
const frozen = JSON.parse(readFileSync(join(design, 'CONTROLS.json')));
const history = JSON.parse(readFileSync(join(design, 'HISTORICAL10.json')));
const matrix = JSON.parse(readFileSync(join(source, history.source.path)));
assert.deepEqual(matrix.categories.namedLocale, history.rows);
assert.equal(hash(readFileSync(join(source, history.source.path))), history.source.sha256);
const { controls } = await import(pathToFileURL(join(design, 'control-inputs.mjs')));
const { select, admission } = await import(pathToFileURL(join(design, 'policy-model.mjs')));
assert.deepEqual(frozen, controls());
for (const row of frozen.selectors) assert.deepEqual({ character: select(row.env, 'LC_CTYPE'), collation: select(row.env, 'LC_COLLATE') }, row.expected);
for (const row of frozen.rows) assert.deepEqual(admission(row), row.expected);
const imports = new Set(), workers = new Set();
const hooks = registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); if (context.parentURL?.startsWith(base)) { assert(result.url.startsWith(base) || result.url.startsWith('node:')); imports.add(result.url); } return result; } });
let state;
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) { assert(url.href.startsWith(base)); state.events.push('worker-acquired'); super(url, options); workers.add(this); this.on('exit', () => workers.delete(this)); }
};
syncBuiltinESMExports();
const { createExprCommand, exprCommands } = await import(`${base}dist/commands/expr/index.js`);
const { Budget, settings, utf8Profile, requireByteCollation, screenMatch } = await import(`${base}dist/commands/expr/internal.js`);
const { RegexSession } = await import(`${base}dist/commands/regex-execution/client.js`);
const { Shell } = await import(`${base}dist/shell/shell.js`);
const { createMemoryFileSystem } = await import(`${base}dist/fs/memory/index.js`);
const match = RegexSession.prototype.matchExpr;
RegexSession.prototype.matchExpr = async function(descriptor, subject) { state.jobs++; return match.call(this, descriptor, subject); };
async function run(argv, env, shellMode = false) {
  state = { jobs: 0, events: [] };
  const stdout = [], stderr = [], cleanups = [], originalEnv = structuredClone(env);
  let response, shell;
  try {
    if (shellMode) {
      shell = new Shell({ fs: createMemoryFileSystem(), env }).use(exprCommands());
      const quote = token => `'${token.replaceAll("'", "'\\''")}'`;
      const result = await shell.exec(['expr', ...argv].map(quote).join(' '));
      response = { status: result.exitCode, stdoutHex: Buffer.from(result.stdout).toString('hex'), stderrHex: Buffer.from(result.stderr).toString('hex') };
    } else {
      const result = await createExprCommand().execute({ command: 'expr', args: argv, cwd: '/', env, signal: new AbortController().signal,
        get stdin() { throw Error('stdin acquired'); }, get fs() { throw Error('fs acquired'); }, get invoke() { throw Error('invoke acquired'); },
        registerCleanup(cleanup) { state.events.push('cleanup-registered'); cleanups.push(cleanup); },
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
      response = { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex') };
    }
    assert.equal(workers.size, 0, 'cooperative worker cleanup before execute settlement');
  } finally { await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()])); await shell?.dispose(); }
  assert.deepEqual(env, originalEnv);
  if (state.jobs && !shellMode) assert.equal(state.events[0], 'cleanup-registered');
  return { ...response, jobs: state.jobs, events: state.events, activeAtSettlement: workers.size };
}
const equalResult = (actual, expected) => ['status', 'stdoutHex', 'stderrHex'].every(key => actual[key] === expected[key]);
const result = (status, stdout = '', stderr = '') => ({ status, stdoutHex: Buffer.from(stdout).toString('hex'), stderrHex: Buffer.from(stderr).toString('hex') });
try {
  const named = [];
  for (const row of history.rows) {
    const expected = row.id === 'unicode-collation' ? result(2, '', 'expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n') : { status: row.expected.status, stdoutHex: row.expected.stdout.hex, stderrHex: row.expected.stderr.hex };
    const actual = await run(row.input.argv, row.virtualInvocation.environment);
    const shell = await run(row.input.argv, row.virtualInvocation.environment, true);
    named.push({ id: row.id, original: row, expected, actual, shell, passed: equalResult(actual, expected), shellPassed: equalResult(shell, expected), frozenNativeStrict: equalResult(actual, { status: row.expected.status, stdoutHex: row.expected.stdout.hex, stderrHex: row.expected.stderr.hex }) });
  }
  const selectors = [];
  for (const row of frozen.selectors) {
    const character = row.expected.character.value, collate = row.expected.collation.value;
    const expectedLength = ['C', 'POSIX'].includes(character) ? result(0, '2\n') : ['C.UTF-8', 'C.utf8', 'en_US.UTF-8'].includes(character) ? result(0, '1\n') : result(2, '', 'expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n');
    const expectedComparison = ['C', 'POSIX', 'C.UTF-8', 'C.utf8'].includes(collate) ? result(0, '1\n') : result(2, '', 'expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n');
    const length = await run(['length', 'é'], row.env), comparison = await run(['a', '<', 'b'], row.env);
    selectors.push({ input: row, expectedLength, expectedComparison, length, comparison, passed: equalResult(length, expectedLength) && equalResult(comparison, expectedComparison) });
  }
  const admissions = [];
  for (const row of frozen.rows) {
    const context = { env: row.env, signal: new AbortController().signal };
    let profile = null, actual;
    try {
      if (row.operation === 'string-comparison') requireByteCollation(context);
      else if (['length', 'substr', 'index', 'match'].includes(row.operation)) {
        profile = utf8Profile(context) ? 'utf8-scalar' : 'byte';
        if (row.operation === 'match') screenMatch(Buffer.from(row.subject ?? 'a'), Buffer.from(row.pattern), new Budget(context, settings({})));
      }
      actual = { decision: 'allow', profile, stderr: '' };
    } catch (error) { actual = { decision: 'refuse', profile, stderr: `expr: ${error.message}\n` }; }
    const argv = row.argv ?? ({ length: ['length', 'é'], substr: ['substr', 'é', '1', '1'], index: ['index', 'é', 'é'], 'string-comparison': ['a', '<', 'b'], match: [row.subject ?? 'a', ':', row.pattern] })[row.operation];
    assert(argv, row.id);
    const runtime = await run(argv, row.env);
    const stderr = Buffer.from(runtime.stderrHex, 'hex').toString();
    const admittedAtRuntime = row.expected.decision === 'refuse' ? runtime.status === 2 && stderr === row.expected.stderr && runtime.jobs === 0
      : row.operation === 'match' ? runtime.jobs === 1 && runtime.status <= 2
      : runtime.status <= 1 && stderr === '';
    admissions.push({ input: row, actualProductAdmission: actual, productAdmissionPassed: JSON.stringify(actual) === JSON.stringify(row.expected), runtimeArgv: argv, runtime, runtimeAdmissionPassed: admittedAtRuntime });
  }
  console.log(JSON.stringify({ classification: 'Frozen 14/517 MODEL checks separately verified, not counted as product proof. Product gate executes same input values. Runtime argv realizations for operation-only sketches are postcandidate supplements, not new prefreeze argv holdouts. Admission permits subsequent worker syntax refusals; not whole-regex semantic acceptance.', model: { selectors: 14, admissions: 517 }, selectors, admissions, named,
    summary: { selectors: selectors.filter(row => row.passed).length, selectorTotal: selectors.length, productGate: admissions.filter(row => row.productAdmissionPassed).length, gateTotal: admissions.length, runtimeAdmission: admissions.filter(row => row.runtimeAdmissionPassed).length, runtimeTotal: admissions.length, namedUserPolicy: named.filter(row => row.passed).length, namedShell: named.filter(row => row.shellPassed).length, namedFrozenNativeStrict: named.filter(row => row.frozenNativeStrict).length, namedTotal: named.length }, imports: [...imports].sort(), activeWorkers: workers.size }));
} finally {
  await Promise.all([...workers].map(worker => worker.terminate()));
  RegexSession.prototype.matchExpr = match; threads.Worker = NativeWorker; syncBuiltinESMExports(); hooks.deregister();
}
