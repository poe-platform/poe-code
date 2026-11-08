import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(readFileSync(join(here, name)));
const cases = json('cases.frozen.json');
for (const [name, digest] of Object.entries(json('FREEZE.json').files)) assert.equal(hash(readFileSync(join(here, name))), digest);
const rows = readFileSync(join(here, 'product-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const native = readFileSync(join(here, 'native-results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(rows.length, cases.product.length);
assert.deepEqual(rows.map(row => row.id), cases.product.map(row => row.id));
const failures = rows.filter(row => !row.pass);
assert.deepEqual(failures.map(row => row.id), ['new-294', 'new-295', 'new-296', 'new-297', 'new-300', 'new-302', 'new-306', 'new-307', 'new-308', 'new-309', 'new-310']);
assert.ok(rows.every(row => row.sampleMatch && row.invocationMatch));
const rejectionClassification = failures.map(row => {
  const message = row.category === 'allocation-admission' ? `shell: line 1: EFBIG: ${row.expected.message}\n` : 'date: invalid calendar date or time\n';
  assert.deepEqual({ status: row.actual.status, stdoutHex: row.actual.stdoutHex, stderrHex: row.actual.stderrHex, writes: row.stdoutWrites },
    { status: 1, stdoutHex: '', stderrHex: Buffer.from(message).toString('hex'), writes: 0 });
  return { id: row.id, retainedResult: 'FAIL (not promoted)', classification: row.category === 'allocation-admission'
    ? 'Harness expected a direct-command thrown FsError; Shell correctly turns it into status1 and a diagnostic. Expected error message also omitted the FsError EFBIG prefix.'
    : 'Frozen new diagnostic omitted "or time". Invalid date refusal and no-partial-stdout are correct.', actualMessage: message };
});
const priorPath = join(here, '../../../time-env/fix-review/evidence/after/fresh-native-matrix.json');
const priorBytes = readFileSync(priorPath);
const prior = JSON.parse(priorBytes);
const oldLabels = prior.rows.filter(row => row.category !== 'required-format');
const difference = row => {
  assert.ok(row.actual && row.gnu);
  return row.actual.status !== row.gnu.status || row.actual.stdoutHex !== row.gnu.stdoutHex || row.actual.stderrHex !== row.gnu.stderrHex;
};
const knownFive = oldLabels.filter(difference);
assert.equal(knownFive.length, 5);
const knownProfile = { path: 'tests/commands/time-env/fix-review/evidence/after/fresh-native-matrix.json', sha256: hash(priorBytes),
  total: prior.rows.length, labelRows: oldLabels.length, strictLabelMismatches: knownFive.length,
  note: 'Historical immutable matrix, read and hashed, not rerun or added to the312 new cases. Exact rows remain in the original evidence.',
  rows: knownFive };
writeFileSync(join(here, 'preserved-ICU-profile-v2.json'), JSON.stringify(knownProfile, null, 2) + '\n', { flag: 'wx' });
const summary = { identity: cases.identity, frozenCasesSha256: hash(readFileSync(join(here, 'cases.frozen.json'))),
  originalProductProcessStatus: json('source-manifest.json').resultStatus, originalHarnessPasses: rows.filter(row => row.pass).length,
  originalHarnessFailures: failures.length, total: rows.length, noProductRerun: true,
  terminalHarnessFailure: 'After all312 rows, deepStrictEqual(process.env, {...process.env}) rejects Node process.env exotic prototype despite identical entries. consumer.stderr preserves it; no green retry.',
  importEvidenceLimit: 'Per-load SHA256 guard and outside-dist negative control ran before all312 rows. The import list and final environment summary were scheduled after the terminal assertion, so were not emitted; no invented successful log.',
  strictNativeTotal: rows.filter(row => row.strictNativeMatch !== null).length, strictNativeMatches: rows.filter(row => row.strictNativeMatch === true).length,
  strictNativeMismatches: rows.filter(row => row.strictNativeMatch === false).map(row => row.id),
  rejectionClassification, sourceProof: json('native-summary.json'),
  categories: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => {
    const group = rows.filter(row => row.category === category);
    return [category, { rows: group.length, originalPasses: group.filter(row => row.pass).length,
      strictNativeMeasured: group.filter(row => row.strictNativeMatch !== null).length, strictNativeMatches: group.filter(row => row.strictNativeMatch === true).length }];
  })), fractionDirectiveComparisons: cases.product.filter(row => row.directives).reduce((total, row) => total + row.directives.length, 0),
  sourceDomainFinding: 'No supported-domain fraction or ISO source defect observed in frozen rows. The unrestricted GNU negative-year magnitude proof is false; source acceptance must remain qualified.',
  preservedHistoricalICULabelMismatches: knownFive.length,
};
writeFileSync(join(here, 'classification-v2.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
if (!existsSync(join(here, 'canonical-native-proposals.json'))) {
const scratch = mkdtempSync('/tmp/fraction-semantics-proposals-');
try {
  const profile = json('native-profile.json');
  assert.equal(hash(readFileSync(profile.binary)), profile.binarySha256);
  const proposals = [['-d@0', '+%12N'], ['-d@0', '+%-N'], ['-d@0', '+%--N']].map(args => {
    const result = spawnSync(profile.binary, args, { cwd: scratch, env: { LC_ALL: 'C', TZ: 'UTC0' }, timeout: 3000, maxBuffer: 4096 });
    assert.equal(result.status, 0);
    return { args, status: result.status, signal: result.signal, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
  });
  writeFileSync(join(here, 'canonical-native-proposals.json'), JSON.stringify({
    note: 'Only the two user-requested legacy canonical inputs plus ordinary %--N policy witness; native-only classification after freeze, outside the312/1624 denominators. No product rerun, no canonical edits.',
    binary: profile.binary, binarySha256: profile.binarySha256, env: { LC_ALL: 'C', TZ: 'UTC0' }, rows: proposals,
  }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(scratch, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ total: summary.total, originalPasses: summary.originalHarnessPasses, originalFailures: summary.originalHarnessFailures,
  strictNative: `${summary.strictNativeMatches}/${summary.strictNativeTotal}`, ICU: knownFive.length, noRerun: true }));
