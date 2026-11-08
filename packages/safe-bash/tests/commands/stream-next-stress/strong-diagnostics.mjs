import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const authorizationPath = process.argv[4] ?? '/tmp/safe-bash-stream-next-reviewer-diagnostic-profile.ready';
const authorizationDocument = readFileSync(authorizationPath, 'utf8');
const authorization = authorizationPath.endsWith('.json') ? JSON.parse(authorizationDocument).diagnosticAuthorization : authorizationDocument;
assert.match(authorization, /authorizes a SEPARATE stronger/u);
const inputPath = resolve(process.argv[2] ?? join(owned, 'evidence/initial/results.json'));
const outputPath = resolve(process.argv[3] ?? join(owned, '.private/strong-diagnostics.json'));
if (!outputPath.startsWith(join(owned, '.private/'))) throw new Error('Generated results must remain private until apply_patch publication');
const original = JSON.parse(readFileSync(inputPath, 'utf8'));
const native = JSON.parse(readFileSync(join(owned, 'frozen/native.json'), 'utf8'));
const primary = original.comparisons.filter(row => row.profile === (row.id.startsWith('rev-') ? 'apple' : 'gnu-darwin'));
const text = encoded => Buffer.from(encoded, 'base64').toString('utf8');
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const hasOperand = (diagnostic, operand) => new RegExp(`(?:^|[\\s/'"])${escaped(operand)}(?=$|[\\s'":;])`, 'u').test(diagnostic);
const rules = new Map();
const define = (id, category, patterns, operands = []) => rules.set(id, { category, patterns, operands });
const absent = /\bENOENT\b|no such file or directory/iu;
const directory = /\bEISDIR\b|(?:is a|on a) directory/iu;
for (const command of ['nl', 'rev', 'unexpand']) define(`${command}-missing-then-file`, 'ENOENT', [absent], ['missing']);
define('split-missing-input', 'ENOENT', [absent], ['missing']);
define('split-missing-parent', 'ENOENT', [absent], ['missing/out.aa']);
define('split-input-directory', 'EISDIR', [directory], ['input']);
define('split-second-output-directory', 'EISDIR', [directory], ['out.ab']);
define('seq-zero-step', 'zero-increment', [/zero.*increment|increment.*zero/iu]);
define('seq-invalid-format', 'format-conversion-count', [/format/iu, /too many.*%|exactly one.*conversion|invalid.*format/iu], ['%f %f']);
define('seq-format-width-conflict', 'format-width-conflict', [/format/iu, /equal width/iu, /may not|cannot|conflict/iu]);
define('seq-invalid-number', 'invalid-numeric-value', [/invalid|illegal/iu, /floating point|decimal|numeric|number/iu], ['one']);
define('seq-missing-operand', 'missing-numeric-operand', [/missing.*operand|expected.*numeric operands/iu]);
define('nl-invalid-style', 'invalid-numbering-style', [/invalid|illegal/iu, /numbering|line.*type/iu], ['z']);
define('rev-malformed-utf8', 'illegal-byte-sequence', [/illegal byte sequence|invalid.*utf.?8|invalid.*multibyte/iu], ['stdin']);
define('rev-truncated-utf8', 'illegal-byte-sequence', [/illegal byte sequence|invalid.*utf.?8|invalid.*multibyte/iu], ['stdin']);
define('rev-unknown-option', 'invalid-option', [/illegal option|invalid option|unknown option/iu], ['q']);
define('unexpand-invalid-zero-stop', 'zero-tab-size', [/tab.*(?:0|zero)|invalid.*(?:number|value).*0/iu]);
define('unexpand-decreasing-stops', 'nonascending-tab-stops', [/tab/iu, /ascending|increasing/iu]);
define('split-suffix-exhaustion', 'suffix-exhaustion', [/suffix/iu, /exhaust/iu]);
define('split-output-is-input', 'input-output-alias', [/overwrite.*input|input.*output.*same/iu], ['xaa']);
define('split-hardlink-output-alias', 'input-output-alias', [/overwrite.*input|input.*output.*same/iu], ['out.aa']);
define('split-symlink-output-alias', 'input-output-alias', [/overwrite.*input|input.*output.*same/iu], ['out.aa']);
define('split-zero-size', 'invalid-byte-size', [/invalid/iu, /bytes|size/iu], ['0']);
define('split-conflicting-modes', 'conflicting-split-modes', [/more than one way|conflict.*(?:mode|option)|cannot.*combine/iu]);
define('split-extra-operand', 'extra-operand', [/extra.*operand|too many.*operand/iu], ['extra']);

function diagnosticCheck(id, diagnostic) {
  const rule = rules.get(id);
  if (!rule) return { passed: false, reason: 'No explicit named diagnostic rule; not presumed compatible' };
  if (!rule.patterns.every(pattern => pattern.test(diagnostic))) return { passed: false, reason: `Expected diagnostic category ${rule.category}` };
  const mismatchedErrno = /\b(EACCES|EISDIR|ENOENT|ENOTDIR|EROFS|ENOSPC)\b/u.exec(diagnostic)?.[1];
  if (rule.category.startsWith('E') && mismatchedErrno && mismatchedErrno !== rule.category) return { passed: false, reason: `Wrong errno ${mismatchedErrno}` };
  const missing = rule.operands.filter(operand => !hasOperand(diagnostic, operand));
  return { passed: missing.length === 0, reason: missing.length ? `Missing relevant operand ${JSON.stringify(missing)}` : rule.category };
}

const nativeSelfChecks = [];
const mutations = [];
for (const record of native.records.filter(record => record.status !== 0 && record.profile === (record.id.startsWith('rev-') ? 'apple' : 'gnu-darwin'))) {
  const diagnostic = text(record.stderr);
  const self = diagnosticCheck(record.id, diagnostic);
  nativeSelfChecks.push({ id: record.id, ...self });
  assert.ok(self.passed, `Native diagnostic must satisfy its own explicit rule: ${record.id}: ${self.reason}`);
  const operands = rules.get(record.id).operands.join(' ');
  for (const [kind, mutated] of [['wrong-errno', `${record.fixture.command}: EACCES: permission denied '${operands}'\n`], ['generic-name-and-path', `${record.fixture.command}: error '${operands}'\n`]]) {
    const rejected = !diagnosticCheck(record.id, mutated).passed;
    mutations.push({ id: record.id, kind, mutated, rejected });
    assert.ok(rejected, `Classifier accepted ${kind} mutation for ${record.id}`);
  }
  const operand = rules.get(record.id).operands[0];
  if (operand) {
    const mutated = diagnostic.replaceAll(operand, 'WRONG_OPERAND');
    const rejected = !diagnosticCheck(record.id, mutated).passed;
    mutations.push({ id: record.id, kind: 'wrong-operand', mutated, rejected });
    assert.ok(rejected, `Classifier accepted wrong operand for ${record.id}`);
  }
}
const rows = primary.map(row => {
  const nonDiagnosticEqual = ['status', 'stdout', 'after'].every(key => JSON.stringify(row.expected[key]) === JSON.stringify(row.actual[key]));
  const diagnostic = row.expected.status === 0
    ? { passed: row.expected.stderr === row.actual.stderr, reason: 'Exact successful stderr' }
    : diagnosticCheck(row.id, text(row.actual.stderr));
  return { id: row.id, backend: row.backend, strict: row.strict, originalWeakSelected: row.semantic,
    strengthened: nonDiagnosticEqual && diagnostic.passed, diagnostic, nonDiagnosticEqual };
});
const summarize = selected => ({ executions: selected.length, strict: selected.filter(row => row.strict).length,
  originalWeakSelected: selected.filter(row => row.originalWeakSelected).length, strengthened: selected.filter(row => row.strengthened).length });
const report = { profile: 'diagnostic-meaning-v2', measuredAt: new Date().toISOString(), authorization,
  sourceResults: inputPath, sourceResultsSha256: createHash('sha256').update(readFileSync(inputPath)).digest('hex'),
  classifierSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  rules: Object.fromEntries([...rules].map(([id, rule]) => [id, { category: rule.category, patterns: rule.patterns.map(String), operands: rule.operands }])),
  nativeSelfChecks, mutationControls: mutations, rows, summary: summarize(rows),
  byBackend: Object.fromEntries(['memory', 'real'].map(backend => [backend, summarize(rows.filter(row => row.backend === backend))])),
  limitations: 'Separate root-authorized stricter profile. Native inputs/raw expectations/strict and original weak-selected outcomes unchanged. Synthetic classifier mutations are not new native or product input coverage. Secondary Apple profiles are not relabeled primary GNU semantics.' };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary: report.summary, failures: rows.filter(row => !row.strengthened), nativeSelfChecks: nativeSelfChecks.length, rejectedMutations: mutations.length, outputPath }, null, 2));
process.exitCode = rows.every(row => row.strengthened) ? 0 : 1;
