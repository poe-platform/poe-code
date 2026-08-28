import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const oldBase = 'tests/commands/apply-patch-independent-20260828/remaining-harness-v8';
const newBase = 'tests/commands/apply-patch-independent-20260828/remaining-harness-v9';
const oldRoot = path.resolve(oldBase, 'recipe');
const newRoot = path.resolve(newBase, 'recipe');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const oldSealBytes = fs.readFileSync(path.join(oldRoot, 'DISCOVERY-PRESEAL.json'));
assert.equal(sha256(oldSealBytes), '89dda7ee6a84e37953c5736db6dedfce55df9f423db672c456743d4327c665ad');
const oldSeal = JSON.parse(oldSealBytes);
const files = {};
for (const [name, binding] of Object.entries(oldSeal.files)) {
  const bytes = fs.readFileSync(path.join(oldRoot, name));
  assert.equal(bytes.length, binding.bytes);
  assert.equal(sha256(bytes), binding.sha256);
  assert.equal(fs.lstatSync(path.join(oldRoot, name)).mode & 0o777, binding.mode);
  files[name] = bytes.toString('utf8');
}
function once(text, before, after) {
  assert.equal(text.split(before).length, 2, before);
  return text.replace(before, after);
}
const originalData = files['data-controls.mjs'];
files['data-controls.mjs'] = once(originalData,
  'assert.equal(Buffer.byteLength(canonical.expected.stderr.utf8), 38);',
  'assert.equal(Buffer.byteLength(canonical.expected.stderr.utf8), 40);');
files['data-controls.mjs'] = once(files['data-controls.mjs'], 'canonicalBytes: 38,', 'canonicalBytes: 40,');
const originalFixtures = files['FIXTURES-v6.json'];
files['FIXTURES-v6.json'] = once(originalFixtures,
  'Root authorizes exact 38-byte canonical diagnostic.',
  'Root corrects the count to 40 bytes for the exact unchanged canonical diagnostic.');
const oldFixtures = JSON.parse(originalFixtures);
const fixtures = JSON.parse(files['FIXTURES-v6.json']);
const restored = structuredClone(fixtures);
const description = restored.cases[0].deltas.find(delta => delta.path === '/expected/stderr');
assert.ok(description);
description.reason = oldFixtures.cases[0].deltas.find(delta => delta.path === '/expected/stderr').reason;
assert.deepEqual(restored, oldFixtures);
const canonical = fixtures.cases[0].row.expected.stderr.utf8;
assert.equal(canonical, 'apply_patch: permission denied: /work/a\n');
assert.equal(Buffer.byteLength(canonical), 40);
const branches = fixtures.cases[3].row.expected.stderr.exactUtf8Alternatives;
assert.deepEqual(branches.map(value => Buffer.byteLength(value)), [98, 92]);
const input = JSON.parse(files['INPUTS-v6.json']);
const fixtureBytes = Buffer.from(oldSeal.mainTemplate.fixturePreparation.bodyBase64, 'base64');
assert.deepEqual(fixtureBytes, Buffer.from(`${input.bodyPrefix}${input.variants[0]}\n`));
assert.equal(sha256(fixtureBytes), oldSeal.mainTemplate.fixturePreparation.bodySha256);
assert.equal(Buffer.byteLength('release\n'), 8);
assert.equal(Buffer.alloc(64).byteLength, 64);
assert.equal(Buffer.alloc(65).byteLength, 65);
function gitObject(kind, payload) {
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`${kind} ${payload.length}\0`), payload])).digest('hex');
}
const blob = gitObject('blob', Buffer.from(input.gitBlob));
const tree = gitObject('tree', Buffer.concat(input.gitPaths.map(name => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(blob, 'hex')]))));
const commit = gitObject('commit', Buffer.from(`tree ${tree}\n${input.gitCommitTail}`));
assert.deepEqual([blob, tree, commit], [oldSeal.mainTemplate.gitFixture.blob, oldSeal.mainTemplate.gitFixture.tree, oldSeal.mainTemplate.gitFixture.commit]);
const gitBytes = Buffer.concat(input.gitPaths.map(name => Buffer.from(`100644 blob ${blob}\t${name}\0`)));
assert.equal(gitBytes.toString('base64'), oldSeal.mainTemplate.gitFixture.expectedStdoutBase64);
assert.equal(sha256(gitBytes), oldSeal.mainTemplate.gitFixture.expectedStdoutSha256);
for (const fixture of fixtures.cases) {
  const bytes = Buffer.from(fixture.originalSourceBase64, 'base64');
  assert.equal(sha256(bytes), fixture.originalSourceSha256);
}
for (const name of ['owner.mjs', 'data-controls.mjs']) files[name] = files[name].replaceAll(oldRoot, newRoot);
assert.equal(files['owner.mjs'].split("assert.ok(elapsed() < 600000,").length, 3);
files['owner.mjs'] = files['owner.mjs'].replaceAll('assert.ok(elapsed() < 600000,', 'assert.ok(elapsed() < 300000,').replace('remaining-harness-v8-source-data-outcome', 'remaining-harness-v9-source-data-outcome');
const remap = value => typeof value === 'string' ? value.replaceAll(oldRoot, newRoot)
  : Array.isArray(value) ? value.map(remap)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry)])) : value;
const seal = structuredClone(oldSeal);
for (const key of ['launch', 'discovery', 'mainTemplate', 'boundRunRoot']) seal[key] = remap(seal[key]);
seal.schema = 'remaining-harness-v9-count-only-preseal';
seal.authorization = 'ROOT count/description38-to40 only; exact UTF8 unchanged; one qualification; no product GO';
seal.bounds.totalMs = 300000;
seal.bounds.admissionCutoffMs = 270000;
seal.bounds.maximumChildren = 8;
seal.bounds.captureBytes = 16777216;
seal.files = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { bytes: Buffer.byteLength(text), mode: 0o644, sha256: sha256(text) }]));
for (const [name, binding] of Object.entries(oldSeal.files)) seal.sourceBindings[`${oldBase}/recipe/${name}`] = binding;
seal.sourceBindings[`${oldBase}/recipe/DISCOVERY-PRESEAL.json`] = { bytes: oldSealBytes.length, mode: 0o644, sha256: sha256(oldSealBytes) };
files['DISCOVERY-PRESEAL.json'] = JSON.stringify(seal, null, 2) + '\n';
const audit = {
  schema: 'v9-fixed-byte-count-preflight',
  historicalHold: '6f5c1dd8635aeb9a49419dc87b8c348b52fee779',
  canonical: { utf8: canonical, hex: Buffer.from(canonical).toString('hex'), historicalCount: 38, correctedCount: 40, unchangedExactBytes: true },
  branches: branches.map((text, index) => ({ utf8: text, bytes: Buffer.byteLength(text), expected: [98, 92][index] })),
  releaseBytes: 8,
  helperAcceptedBytes: 64,
  helperRefusedBytes: 65,
  regularFixtureBytes: fixtureBytes.length,
  regularFixtureSha256: sha256(fixtureBytes),
  symlinkTargetText: seal.mainTemplate.fixturePreparation.symlink.target,
  symlinkTargetBytes: Buffer.byteLength(seal.mainTemplate.fixturePreparation.symlink.target),
  exactGitStdoutBytes: gitBytes.length,
  exactGitStdoutSha256: sha256(gitBytes),
  gitObjectLengthHeadersRecomputed: { blob, tree, commit },
  originalExcerptHashesVerified: fixtures.cases.length,
  emptyExpectedStderrBytes: 0,
  excludedFromExactStringCounts: ['resource ceilings are upper bounds, not exact string sizes', 'record/control/entry counts are not byte counts', 'environment and streamed output sizes are observed at runtime within sealed caps'],
  changedExpectations: ['D02 canonical byte count38-to40', 'D02 emitted canonicalBytes38-to40', 'S62 delta reason description only'],
  otherChanges: ['exact versioned root path substitution', 'ROOT-approved five-minute/eight-process/16MiB qualification ceilings'],
  presealSha256: sha256(files['DISCOVERY-PRESEAL.json']),
  files: seal.files,
  productRuns: 0,
};
const additions = Object.entries(files).map(([name, text]) => [`${newBase}/recipe/${name}`, text]);
additions.push([`${newBase}/BYTE-PREFLIGHT.json`, JSON.stringify(audit, null, 2) + '\n']);
process.stdout.write('*** Begin Patch\n' + additions.map(([filename, text]) => {
  assert.equal(fs.existsSync(filename), false);
  assert.ok(text.endsWith('\n'));
  return `*** Add File: ${filename}\n${text.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n`;
}).join('') + '*** End Patch\n');
