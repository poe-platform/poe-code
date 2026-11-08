import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { holdoutsV2 } from './holdouts-v2.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(readFileSync(directory + 'freeze.json'));
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const source = git(['show', `${original.baselineCommit}:src/commands/text.ts`]);
assert.equal(hash(source), '08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d');
assert.ok(source.toString().includes('const flags = key?.flags.size ? key.flags : parsed.flags;'));
const coordination = readFileSync('/tmp/sort-unkeyed-review-coordination.txt');
assert.ok(coordination.toString().includes('Authorize ONLY a separately versioned own fixture correction'));
const originalExpected = readFileSync(directory + 'expected.json');
assert.equal(hash(originalExpected), original.expectedSha256);
const specimens = holdoutsV2();
assert.equal(specimens.length, 34);
const previous = JSON.parse(originalExpected).specimens;
for (let index = 0; index < previous.length; index++) {
  if (previous[index].id !== 'guard-key-local-replaces-global') assert.deepEqual(specimens[index], previous[index]);
  else assert.deepEqual({ ...specimens[index], id: previous[index].id, expected: { ...specimens[index].expected, stdout: previous[index].expected.stdout } }, previous[index]);
}
const expectedBytes = JSON.stringify({ specimens }, null, 2) + '\n';
writeFileSync(directory + 'expected-v2.json', expectedBytes, { flag: 'wx' });
writeFileSync(directory + 'coordination-v2.txt', coordination, { flag: 'wx' });
writeFileSync(directory + 'freeze-v2.json', JSON.stringify({
  created: new Date().toISOString(), baselineCommit: original.baselineCommit,
  originalFreezeCommit: 'fcd6d0218725342e4ef1aa098e23b0cdfbe9cd10',
  originalExpectedSha256: hash(originalExpected), expectedSha256: hash(expectedBytes),
  holdoutsSha256: hash(readFileSync(directory + 'holdouts-v2.mjs')),
  rootAuthorizationSha256: hash(coordination), caseCount: specimens.length,
  candidateInspected: false, candidateExecuted: false,
  sourceEffectiveFlagsVerified: true, unchangedOriginalCases: 32,
  correctedOriginalCases: 1, addedExplicitLocalReplacementCases: 1,
  capRecipesUnchanged: 11, originalBaselineOutcome: '21/21 acceptance and 32/33 original hidden; immutable failure retained',
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ count: specimens.length, sha256: hash(expectedBytes), candidateInspected: false }));
