import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const revision = 'd5f068cd3649c09c6e4573645b64de505875adc3';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const references = [];
function blob(path) {
  const bytes = git(['show', `${revision}:${path}`]);
  references.push({ revision, path, gitBlob: git(['rev-parse', `${revision}:${path}`]).toString().trim(), sha256: hash(bytes) });
  return bytes;
}
const prefix = 'tests/integration/full-gate-20260827/';
const readiness = JSON.parse(blob(`${prefix}readiness-73/INVENTORY.json`));
const readme = blob(`${prefix}readiness-73/README.md`).toString();
const expectedRg = '4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f';
const observedRg = '5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7';
assert.ok(readme.includes(expectedRg) && readme.includes(observedRg));
assert.equal(readiness.mts.unclassified.length, 11);
assert.equal(readiness.registry.count, 73);
assert.equal(readiness.cleanup.currentCount, 244);
const modules = [
  `${prefix}account.mjs`,
  'tests/plugins/qualified-current-release/runtime-coverage.mjs',
  'tests/plugins/qualified-current-release/inventory-check.mjs',
  'tests/plugins/stream-five-public/current-profile.mjs',
];
for (const path of modules) {
  const bytes = blob(path), target = resolve(owned, 'baseline', path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
}
const migrations = [
  { path: 'tests/commands/split/integration.test.ts', assertionLines: [39, 45], titleLine: 38 },
  { path: 'tests/commands/stream-format-author-stress/contracts.test.ts', assertionLines: [19, 26], titleLine: 17 },
].map(entry => ({ ...entry, sha256: hash(blob(entry.path)), from: 70, to: 73 }));
const individualMts = readiness.mts.unclassified.map(path => ({ path, sha256: hash(blob(path)), classification: null, route: null, provenance: null }));
for (const path of [
  `${prefix}readiness-73/inventory.mjs`, `${prefix}readiness-73/RECEIPT.json`,
  `${prefix}combined-8670ebe8/run.mjs`, `${prefix}combined-8670ebe8/policy.json`,
  `${prefix}combined-8670ebe8/committed-archive.mjs`, `${prefix}combined-8670ebe8/import-guard.mjs`,
  `${prefix}preflight-repair/run.mjs`, `${prefix}runtime-profile-20260827/profile.mjs`,
  `${prefix}supervise.mjs`, 'scripts/verify-current-consumers.mjs', 'scripts/verify-whole-gate.mjs',
  'tests/plugins/qualified-current-release/consumers.mjs', 'tests/plugins/qualified-current-release/inventory.json',
  'tests/plugins/agent-commands.test.ts',
]) blob(path);
const negativePath = 'tests/plugins/qualified-current-release/negative-env-split.stdout';
const negativeStdout = blob(negativePath).toString();
const boundary = {
  format: 'independent-release-pre-candidate-v1', frozenAt: new Date().toISOString(), revision,
  observationRevision: readiness.snapshot, observationTree: readiness.tree,
  candidate: null, candidateExecuted: false,
  nativeRg: { expectedSha256: expectedRg, observedSha256: observedRg, observedAt: readiness.at, status: 'unresolved-identity-mismatch; no new native inspection or execution' },
  individualMts, migrations, defaultNames: readiness.registry.declaredNames.sort(), excludedDefaults: ['curl', 'safejs', 'expr', 'du'],
  cleanupObservation: readiness.cleanup.envelope,
  cleanupQualification: '244 at immutable readiness observation only; candidate manifest/root approval pending',
  negativeControl: { path: negativePath, stdout: negativeStdout, diagnostics: 1 },
  references,
};
writeFileSync(resolve(owned, 'boundary.json'), JSON.stringify(boundary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ revision, references: references.length, individualMts: individualMts.length, migrations: migrations.length, cleanupObservation: 244, candidate: null }));
