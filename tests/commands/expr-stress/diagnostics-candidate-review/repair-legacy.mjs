import assert from 'node:assert/strict';
import { existsSync, readFileSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { authenticateSourceTests, inventory } from './integrity.mjs';
import { addEvidence, owned, sha256, json } from './replay/review.mjs';
import { command } from './replay/stage.mjs';

const stage = JSON.parse(readFileSync(`${owned}/candidate-diagnostics/stage.json`));
const first = JSON.parse(readFileSync(`${owned}/regressions/expr-legacy241.json`));
const frozen = JSON.parse(readFileSync(`${owned}/../freeze/independent-native.json`));
const before = authenticateSourceTests(stage);
const relative = 'tests/commands/metadata-stress/.oracle';
const destination = join(stage.source, relative);
const target = dirname(dirname(dirname(frozen.identity.actualPath)));
assert.equal(first.status, 1);
assert(first.stdout.includes('GNU 9.7 expr qualification prerequisite missing'));
assert(!existsSync(destination));
assert.equal(sha256(readFileSync(frozen.identity.actualPath)), frozen.identity.sha256);
const receipt = { candidate: stage.commit, firstRunSha256: sha256(readFileSync(`${owned}/regressions/expr-legacy241.json`)), firstSummary: first.stdout.split('\n').filter(line => /^ℹ|^✖/.test(line)), repair: { kind: 'Read-only external native prerequisite symlink in owned archive, not a product/test source edit', relative, destination, target, executable: frozen.identity }, beforeDigest: sha256(json(before)) };
addEvidence(`${owned}/regressions/legacy-prerequisite-repair-before.json`, receipt);
try {
  symlinkSync(target, destination, 'dir');
  const during = ['src', 'tests'].flatMap(path => inventory(join(stage.source, path), path)).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.deepEqual(during.filter(entry => entry.path !== relative), before);
  assert.equal(during.length, before.length + 1);
  const added = during.find(entry => entry.path === relative);
  assert.equal(added.kind, 'symlink');
  assert.equal(readlinkSync(destination), target);
  assert.equal(sha256(readFileSync(join(destination, 'coreutils-9.7/src/expr'))), frozen.identity.sha256);
  addEvidence(`${owned}/regressions/legacy-prerequisite-bound.json`, { candidate: stage.commit, canonicalSourceTestsCount: before.length, addedNativeFixtureEntries: [added], inventoryDigest: sha256(json(during)), canonicalEntriesIncludingAddedChecked: true });
  const result = await command(process.execPath, first.args, stage.source, 240000);
  addEvidence(`${owned}/regressions/expr-legacy241-qualified.json`, { candidate: stage.commit, exactArchivedTests: true, prerequisiteBinding: receipt.repair, ...result, stdoutBase64: Buffer.from(result.stdout).toString('base64'), stderrBase64: Buffer.from(result.stderr).toString('base64') });
  console.log(JSON.stringify({ status: result.status, failure: result.failure, summary: result.stdout.split('\n').filter(line => /^ℹ|^✖/.test(line)) }));
} finally {
  assert.equal(readlinkSync(destination), target);
  unlinkSync(destination);
  assert.equal(sha256(readFileSync(frozen.identity.actualPath)), frozen.identity.sha256);
  const after = authenticateSourceTests(stage);
  assert.deepEqual(after, before);
  addEvidence(`${owned}/regressions/legacy-prerequisite-repair-after.json`, { candidate: stage.commit, symlinkRemoved: !existsSync(destination), beforeDigest: sha256(json(before)), afterDigest: sha256(json(after)), sourceAndTestsIncludingAddedEntriesUnchanged: true, externalExecutableUnchanged: true });
}
