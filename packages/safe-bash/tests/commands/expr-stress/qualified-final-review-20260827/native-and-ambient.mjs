import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { owned, work, hash, save, command } from './prepare.mjs';
const { source } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const auth = JSON.parse(readFileSync(join(owned, 'native-prerequisites.json')));
assert.equal(hash(readFileSync(auth.native)), auth.expectedHash);
const history = JSON.parse(readFileSync(join(source, 'tests/commands/expr-stress/named-profile-design-20260827/HISTORICAL10.json')));
const sequence = JSON.parse(readFileSync(join(source, 'tests/commands/expr-stress/sequencing-design-20260827/freeze/cases.json')));
const nine = JSON.parse(readFileSync(join(source, 'tests/commands/expr-stress/diagnostics-candidate-review/freeze/nine-unchanged.json')));
const namedProduct = JSON.parse(readFileSync(join(owned, 'named-initial-unqualified-ambient.json')));
const captures = [];
const native = (path, argv, env) => {
  const result = spawnSync(path, argv, { cwd: work, env, argv0: 'expr', timeout: 3000, maxBuffer: 65536 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
};
const same = (left, right) => ['status', 'stdoutHex', 'stderrHex'].every(key => left[key] === right[key]);
const profiles = [];
for (const [name, path] of [['GNU9.7-Darwin', auth.native], ['Apple', '/bin/expr']]) for (const locale of ['C', 'en_US.UTF-8']) {
  const rows = history.rows.map(row => {
    const actual = native(path, row.input.argv, { ...row.nativeInvocation.environment, LC_ALL: locale, LANG: locale });
    const expected = { status: row.expected.status, stdoutHex: row.expected.stdout.hex, stderrHex: row.expected.stderr.hex };
    return { id: row.id, argv: row.input.argv, actual, frozenNamedReferenceMatch: same(actual, expected), candidateNamedStrict: same(actual, namedProduct.named.find(value => value.id === row.id).actual) };
  });
  captures.push({ name, locale, rows });
  profiles.push({ name, locale, total: rows.length, frozenNamedReferenceMatches: rows.filter(row => row.frozenNamedReferenceMatch).length, actualCandidateNamedStrict: locale === 'en_US.UTF-8' ? rows.filter(row => row.candidateNamedStrict).length : null, classification: locale === 'C' ? 'C observation of same argv; different explicit environment, not named-locale parity' : 'Native named-locale actual observations; Apple separate from authenticated GNU on Darwin' });
}
const sequencingRows = sequence.cases.filter(row => row.native !== false).map(row => {
  const actual = native(auth.native, row.args, { LC_ALL: 'C', LANG: 'C', PATH: '/usr/bin:/bin' });
  return { id: row.id, actual, passed: same(actual, { status: row.expected.exitCode, stdoutHex: Buffer.from(row.expected.stdout).toString('hex'), stderrHex: Buffer.from(row.expected.stderr).toString('hex') }) };
});
const diagnosticRows = nine.map(row => {
  const actual = native(auth.native, row.argv, { LC_ALL: 'C', LANG: 'C', PATH: '/usr/bin:/bin' });
  return { id: row.expected.id, actual, passed: same(actual, { status: row.expected.status, stdoutHex: Buffer.from(row.expected.stdoutBase64, 'base64').toString('hex'), stderrHex: Buffer.from(row.expected.stderrBase64, 'base64').toString('hex') }) };
});
const raw = JSON.stringify({ captures, sequencingRows, diagnosticRows }, null, 2) + '\n';
writeFileSync(join(work, 'ephemeral-native-observations.json'), raw, { flag: 'wx' });
save('native-summary.json', { profiles, sequencing: { total: sequencingRows.length, passed: sequencingRows.filter(row => row.passed).length }, diagnostics: { total: diagnosticRows.length, passed: diagnosticRows.filter(row => row.passed).length }, captureSha256: hash(raw), capturePolicy: 'Native raw observations are ephemeral in OWN .work and deleted during cleanup, not committed as captures. This summary is a fresh execution count, not Linux semantics.', nativeStillAuthenticated: hash(readFileSync(auth.native)) === auth.expectedHash });
const outputs = [];
for (const locale of ['C', 'en_US.UTF-8']) {
  const env = { PATH: '/usr/bin:/bin', LC_ALL: locale, LC_CTYPE: locale, LC_COLLATE: locale, LANG: locale, NODE_OPTIONS: '', NODE_PATH: '' };
  const result = command(`named-explicit-ambient-${locale === 'C' ? 'C' : 'enUS'}`, process.execPath, [join(owned, 'named.mjs')], { env });
  assert.equal(result.status, 0, result.stderr); outputs.push(JSON.parse(result.stdout));
}
assert.deepEqual(outputs[0], outputs[1]);
save('named-ambient-summary.json', { environments: ['C', 'en_US.UTF-8'], byteEquivalentParsedResults: true, initialUnqualifiedAmbientRetained: true, results: outputs.map(output => output.summary), noAmbientLocaleSelection: true, qualification: 'Named and fallback behavior unchanged under explicit host locale environments; product receives exactly frozen virtual env maps.' });
console.log(JSON.stringify({ profiles, sequencing: sequencingRows.filter(row => row.passed).length, diagnostics: diagnosticRows.filter(row => row.passed).length, named: outputs[0].summary }));
