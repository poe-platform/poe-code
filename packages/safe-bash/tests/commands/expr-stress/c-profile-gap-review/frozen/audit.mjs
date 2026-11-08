import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(resolve(owned, 'CASE_MATRIX.json'));
const matrix = JSON.parse(bytes);
const executable = '/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr';
const nativeC = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C', TZ: 'UTC' };
const named = { ...nativeC, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };
const refusal = 'expr: unsupported BRE: backreference to a capture in nullable repetition\n';
const characters = 'expr: character operations require C/POSIX or C.UTF-8/C.utf8 locale\n';
const collation = 'expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n';
const nullable = [
  ['empty', '', '\\(a*\\)*\\1', 1, '\n', false],
  ['a', 'a', '\\(a*\\)*\\1', 1, '\n', false],
  ['aa', 'aa', '\\(a*\\)*\\1', 0, 'a\n', false],
  ['aaa', 'aaa', '\\(a*\\)*\\1', 1, '\n', false],
  ['no-reference', 'aaa', '\\(a*\\)*', 0, 'aaa\n', true],
  ['not-repeated', 'aaa', '\\(a*\\)\\1', 0, 'a\n', true],
  ['nonnullable', 'aaa', '\\(a\\)*\\1', 0, 'a\n', true],
  ['mandatory-empty', '', '\\(a*\\)\\{2\\}\\1', 1, '\n', false]
];
const namedCases = [
  ['unicode-length', ['length', 'Aé😀e\u0301'], '5\n'],
  ['unicode-substr', ['substr', 'Aé😀Z', '3', '1'], '😀\n'],
  ['unicode-index', ['index', 'Aé😀Z', 'Z😀'], '3\n'],
  ['unicode-regex-dot', ['é😀', ':', '.'], '1\n'],
  ['unicode-capture', ['é😀', ':', '\\(.\\)'], 'é\n'],
  ['unicode-combining-not-graphemes', ['length', 'e\u0301'], '2\n'],
  ['unicode-collation', ['é', '<', 'z'], '1\n'],
  ['utf8-whole-prefix-span', ['Aé😀Z', ':', 'A..'], '3\n'],
  ['utf8-shifted-first-span', ['Aé😀Z', ':', 'Aé\\(.\\)'], '😀\n'],
  ['combining-first-span', ['e\u0301Z', ':', '\\(e.\\)'], 'e\u0301\n']
];
const diagnostics = [
  ['ambiguous-index-keyword', ['index', 'index', 'a'], "syntax error: missing argument after 'a'", 'syntax error: missing operand'],
  ['missing-operands', [], "missing operand\nTry 'expr --help' for more information.", 'syntax error: missing operand'],
  ['missing-rhs', ['1', '+'], "syntax error: missing argument after '+'", 'syntax error: missing operand'],
  ['missing-close', ['(', '1', '+', '2'], "syntax error: expecting ')' after '2'", "syntax error: expecting ')'"],
  ['trailing-token', ['1', '2'], "syntax error: unexpected argument '2'", 'syntax error: unexpected argument'],
  ['skip-still-requires-rhs', ['kept', '|', '1', '+'], "syntax error: missing argument after '+'", 'syntax error: missing operand'],
  ['skip-still-requires-close', ['0', '&', '(', '1'], "syntax error: expecting ')' after '1'", "syntax error: expecting ')'"],
  ['skip-still-requires-keyword-args', ['kept', '|', 'substr', 'abc', '1'], "syntax error: missing argument after '1'", 'syntax error: missing operand'],
  ['class-parenthesis-not-capture', ['(', ':', '[(]'], "syntax error: expecting ')' instead of '[(]'", "syntax error: expecting ')'" ]
];
function verifyTuple(actual, status, stdout, stderr) {
  assert.equal(actual.status, status);
  assert.equal(actual.signal, null);
  assert.equal(actual.failure, null);
  for (const [stream, text] of [['stdout', stdout], ['stderr', stderr]]) {
    const expectedBytes = Buffer.from(text);
    assert.deepEqual(actual[stream], { base64: expectedBytes.toString('base64'), hex: expectedBytes.toString('hex'), byteLength: expectedBytes.length, utf8: text, utf8Valid: true });
  }
}
function verifyInput(row, argv, virtualEnv, nativeEnv) {
  assert.deepEqual(row.input.argv, argv);
  assert.deepEqual(row.input.argvUtf8Hex, argv.map(arg => Buffer.from(arg).toString('hex')));
  assert.deepEqual(row.nativeInvocation.argv, argv);
  assert.equal(row.nativeInvocation.executable, executable);
  assert.equal(row.nativeInvocation.argv0, 'expr');
  assert.deepEqual(row.nativeInvocation.environment, nativeEnv);
  assert.deepEqual(row.virtualInvocation.environment, virtualEnv);
  assert.equal(row.virtualInvocation.cwd, '/');
  assert.equal(row.virtualInvocation.command, 'expr');
  for (const category of ['character', 'collation']) assert.deepEqual(row.virtualInvocation.localeSelection[category], { selectedBy: 'LC_ALL', value: virtualEnv.LC_ALL });
}
function verifyMatrix(value) {
  assert.equal(value.authentication.candidateCommit, '27a7793526830768484885afba5832bf8bb248b5');
  assert.equal(value.authentication.evidenceCommit, '50b1e560b11adfcd1d1726896832c3c524e28c4d');
  assert.deepEqual(value.categories.nullable.map(row => row.id), nullable.map(row => row[0]));
  assert.deepEqual(value.categories.namedLocale.map(row => row.id), namedCases.map(row => row[0]));
  assert.deepEqual(value.categories.cDiagnostics.map(row => row.id), diagnostics.map(row => row[0]));
  for (const [index, row] of value.categories.nullable.entries()) {
    const [id, subject, pattern, status, stdout, control] = nullable[index];
    assert.equal(row.id, id);
    verifyInput(row, ['+', subject, ':', pattern], { LC_ALL: 'C' }, nativeC);
    verifyTuple(row.expected, status, stdout, '');
    verifyTuple(row.actual, control ? status : 2, control ? stdout : '', control ? '' : refusal);
    assert.equal(row.classification, control ? 'control' : 'semantic failure');
    assert.deepEqual(row.comparison, { semantic: control, diagnostic: control, strict: control });
    assert.equal(row.nativeInvocation.cwd, null);
  }
  for (const [index, row] of value.categories.namedLocale.entries()) {
    const [id, argv, stdout] = namedCases[index];
    assert.equal(row.id, id);
    verifyInput(row, argv, named, named);
    verifyTuple(row.expected, 0, stdout, '');
    verifyTuple(row.actual, 2, '', id === 'unicode-collation' ? collation : characters);
    assert.deepEqual(row.comparison, { semantic: false, diagnostic: false, strict: false });
  }
  for (const [index, row] of value.categories.cDiagnostics.entries()) {
    const [id, argv, expected, actual] = diagnostics[index];
    assert.equal(row.id, id);
    verifyInput(row, argv, nativeC, nativeC);
    verifyTuple(row.expected, 2, '', `expr: ${expected}\n`);
    verifyTuple(row.actual, 2, '', `expr: ${actual}\n`);
    assert.deepEqual(row.comparison, { semantic: true, diagnostic: false, strict: false });
  }
  const correction = value.separateQuotedCorrection.find(row => row.profile.startsWith('gnu-'));
  assert.deepEqual(correction.input.argv, ['+', '(', ':', '[(]']);
  verifyTuple(correction.expected, 0, '1\n', '');
  verifyTuple(correction.actual, 0, '1\n', '');
  assert.equal(value.separateAppleCounterparts.length, 19);
  assert(value.separateAppleCounterparts.every(row => row.profile.startsWith('apple-')));
  assert.equal(value.separateNamedLocaleControls.length, 2);
  assert(value.separateNamedLocaleControls.every(row => row.comparison.strict));
  assert.equal(value.counts.requestedObservations, 27);
  assert.deepEqual(value.counts.nullable, { observations: 8, semanticFailures: 5, controls: 3, separateFromOriginalAndExtension: true });
}
verifyMatrix(matrix);
const controls = [
  ['dropped nullable control', value => value.categories.nullable.splice(4, 1)],
  ['changed subject normalization', value => value.categories.namedLocale[0].input.argv[1] = 'Aé😀é'],
  ['changed argv0 to pathname', value => value.categories.cDiagnostics[0].nativeInvocation.argv0 = executable],
  ['normalized executable pathname', value => value.categories.cDiagnostics[0].nativeInvocation.executable = 'expr'],
  ['native env mislabelled virtual', value => value.categories.nullable[0].virtualInvocation.environment = nativeC],
  ['silently substituted C.UTF-8', value => value.categories.namedLocale[0].virtualInvocation.environment.LC_ALL = 'C.UTF-8'],
  ['normalized GNU help trailer', value => value.categories.cDiagnostics[1].expected.stderr.utf8 = 'expr: missing operand\n'],
  ['changed exact stderr bytes', value => value.categories.cDiagnostics[0].expected.stderr.hex += '0a'],
  ['nullable refusal relabelled control', value => value.categories.nullable[0].comparison.semantic = true],
  ['quoted correction replaces original', value => value.categories.cDiagnostics[8].input.argv.unshift('+')]
];
for (const [name, mutate] of controls) {
  const changed = structuredClone(matrix);
  mutate(changed);
  assert.throws(() => verifyMatrix(changed), { name: 'AssertionError' }, name);
}
assert.equal(createHash('sha256').update(bytes).digest('hex'), 'ae334dcecc459d59e89d0183067b828ae4848ef48db300391dbe0971ec6046d2');
console.log(JSON.stringify({ result: 'PASS exact historical matrix audit', requestedObservationsChecked: 27, rejectedInMemoryMutations: controls.map(([name]) => name), productOrNativeExecutions: 0, filesWritten: 0 }, null, 2));
