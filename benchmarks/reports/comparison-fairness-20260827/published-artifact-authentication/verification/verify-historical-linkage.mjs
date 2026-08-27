import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const auth = path.dirname(own);
const repo = path.resolve(own, '../../../../..');
const prior = path.join(repo, 'benchmarks/reports/current-integration/comparison-replay-20260827');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = {};
function read(filename) {
  const bytes = fs.readFileSync(filename);
  if (inputs[filename]) assert.equal(hash(bytes), inputs[filename]);
  inputs[filename] = hash(bytes);
  return bytes;
}
const json = filename => JSON.parse(read(filename));
const report = { kind: 'OFFLINE_HISTORICAL_BYTE_LINKAGE_NOT_NEW_EXECUTION', at: new Date().toISOString(), productCalls: 0, networkRequests: 0, blockers: [] };
try {
  const published = json(path.join(own, 'package-final-attempt-1.json'));
  const history = json(path.join(auth, 'historical-import-authentication.json'));
  const root = json(path.join(own, 'package-final-input.json')).frozenProductRoot;
  report.profiles = [];
  for (const phase of history.phases) {
    const logFile = path.join(prior, phase.phase, 'imports.jsonl');
    assert.equal(hash(read(logFile)), phase.retainedLogSha256);
    const rows = read(logFile).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const prefix = root + '/benchmarks/node_modules/just-bash/';
    const loads = rows.filter(row => row.event === 'module-load' && row.actual?.startsWith(prefix));
    assert.equal(loads.length, phase.packageLoadAttemptEvents);
    const unique = new Map();
    for (const row of loads) {
      const member = row.actual.slice(prefix.length);
      assert.equal(row.sourceSha256, published.package.published[member].sha256, member);
      assert.equal(fileURLToPath(row.url), row.actual);
      unique.set(member, row.sourceSha256);
    }
    assert.equal(unique.size, phase.uniquePackagePaths.length);
    for (const entry of phase.uniquePackagePaths) assert.equal(unique.get(entry.path), entry.sha256);
    assert.equal(unique.get('dist/bundle/index.js'), '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
    const functional = json(path.join(prior, phase.phase, 'functional.json'));
    assert.equal(functional.length, 224);
    assert.equal(new Set(functional.map(row => row.id)).size, 224);
    const scores = {};
    for (const engine of ['virtual-bash', 'just-bash']) {
      let passes = 0;
      for (const row of functional) {
        assert.equal(row.expected.oracleValid, true);
        assert.ok(row[engine].observation);
        const assertions = ['stdout', 'stderr', 'exitCode', 'entries'].map(field => ({ field, pass: JSON.stringify(row.expected[field]) === JSON.stringify(row[engine].observation[field]) }));
        const pass = assertions.every(entry => entry.pass);
        assert.deepEqual(row[engine].comparison, { pass, assertions });
        assert.equal(row[engine].status, pass ? 'pass' : 'fail');
        passes += Number(pass);
      }
      scores[engine] = { pass: passes, fail: functional.length - passes, total: functional.length };
    }
    assert.equal(scores['virtual-bash'].pass, phase.phase === 'original' ? 222 : 223);
    assert.equal(scores['just-bash'].pass, 155);
    report.profiles.push({ profile: phase.phase, historicalPackageLoadAttempts: loads.length, uniqueAuthenticatedPaths: unique.size, entryLoadAttempts: loads.filter(row => row.actual === prefix + 'dist/bundle/index.js').length, scores, interpretation: 'Historical module-load events are load attempts; same path/bytes as the authenticated package, not retrospective all-module evaluation proof.' });
  }
  const guarded = json(path.join(auth, 'guarded-reextraction.json'));
  assert.equal(hash(read(path.join(auth, 'extract.py'))), guarded.extractorSha256);
  const actual = new Set();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink());
      if (entry.isDirectory()) walk(filename);
      else {
        const stat = fs.lstatSync(filename);
        assert.ok(stat.isFile() && stat.nlink === 1);
        const member = path.relative(guarded.destination, filename);
        assert.equal(hash(read(filename)), published.package.published[member]?.sha256);
        actual.add(member);
      }
    }
  }
  walk(guarded.destination);
  assert.deepEqual([...actual].sort(), Object.keys(published.package.published).sort());
  report.guardedReextraction = { files: actual.size, extractorSha256: guarded.extractorSha256, independentlyRehashed: true, extractionByVerifier: false };
  report.priorReviewSha256 = hash(read(path.join(auth, '../verification/FINAL-REVIEW.md')));
  report.scoreQualification = 'Preserved earlier separate original/aligned 224 denominators; no union with these eight observations or historical 54-name/136-outcome baseline-only evidence. Historical cleanup failure is not cured.';
  for (const [filename, expected] of Object.entries(inputs)) assert.equal(hash(fs.readFileSync(filename)), expected);
  report.status = 'HISTORICAL_BYTE_LINK_AND_SCORES_CONFIRMED';
} catch (error) {
  report.status = 'BLOCKED'; report.blockers.push({ message: error.message, stack: error.stack }); process.exitCode = 1;
}
report.inputHashes = inputs;
const output = path.resolve(process.argv[2] ?? '');
assert.ok(output.startsWith(own + '/'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, profiles: report.profiles, blockers: report.blockers }));
