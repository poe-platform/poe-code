import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const correction = join(base, 'corrections/HARN-SIGNAL-001');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(text(path));
const hashes = [];
for (const directory of [base, correction]) {
  const manifest = json(join(directory, 'PUBLICATION.json'));
  assert.equal(manifest.entries.length, manifest.artifactCount);
  for (const entry of manifest.entries) {
    const path = join(directory, entry.path);
    const bytes = readFileSync(path);
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(digest(bytes), entry.sha256, path);
    hashes.push({ path, sha256: entry.sha256 });
  }
}
const metadata = json(join(correction, 'correction.json'));
function replaceOnly(source, changes) {
  for (const change of changes) {
    assert.equal(source.split(change.before).length, 2, change.before);
    source = source.replace(change.before, change.after);
  }
  return source;
}
const original = text(join(correction, 'history/original-isolated-runner.mjs'));
const corrected = text(join(correction, 'runner/corrected-assertions-runner.mjs'));
const observed = text(join(correction, 'runner/corrected-observed-runner.mjs'));
assert.equal(digest(original), '5116aaf53899715e2497140528e5a2338664673e2d284eb688e009dd6e2a2fb5');
assert.equal(metadata.corrections.length, 2);
assert.equal(replaceOnly(original, metadata.corrections), corrected);
assert.equal(replaceOnly(corrected, metadata.observations), observed);
const eventChecks = [];
for (const id of ['F33', 'F34']) {
  const events = text(join(correction, `evidence/results/${id}.events.jsonl`)).trim().split('\n').map(line => JSON.parse(line));
  const position = kind => {
    const matches = events.filter(event => event.kind === kind);
    assert.equal(matches.length, 1, `${id}: ${kind}`);
    return events.indexOf(matches[0]);
  };
  const returned = position('holdout-source-return');
  assert.equal(events[returned].returned, 1);
  const reason = position('holdout-exact-caller-reason-verified');
  const propagation = position('holdout-fs-abort-propagation-verified');
  assert.equal(events[propagation].aborted, true);
  assert.equal(events[propagation].exactReason, true);
  const read = position('holdout-late-read-rejection-injected');
  const window = position('holdout-late-error-window-verified');
  assert(returned < read && reason < read && propagation < read && read < window);
  if (id === 'F34') assert(position('holdout-late-return-rejection-injected') < window);
  else assert.equal(events.filter(event => event.kind === 'holdout-late-return-rejection-injected').length, 0);
  assert.equal(events[window].unhandledCount, 0);
  assert.equal(events[window].eventLoopTurns, 2);
  assert(window < position('holdout-cleanup-gates-released'));
  assert.equal(events.filter(event => event.kind === 'unhandled-rejection').length, 0);
  eventChecks.push({ id, actualInjectionAndWindowOrdering: true });
}
const coverage = json(join(correction, 'evidence/coverage-index.json'));
assert.equal(coverage.isNewFull40Run, false);
assert.equal(coverage.reusedCases, 37);
assert.equal(coverage.rows.length, 40);
const modules = json(join(correction, 'evidence/loaded-modules.json'));
for (const entry of modules) assert.equal(digest(readFileSync(entry.path)), entry.sha256, entry.path);
console.log(JSON.stringify({
  at: new Date().toISOString(), boundary: 'Read-only builtin evidence checks; no product import, test, native oracle, or predicate execution',
  originalPublicationEntries: 285, correctionPublicationEntries: 37,
  exactAssertionReplacements: metadata.corrections.length, exactObservationReplacements: metadata.observations.length,
  loadedModuleHashesChecked: modules.length, eventChecks, hashes,
}, null, 2));
