import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineCommit } from './holdouts.mjs';
import { directory, git, hash, json, repo } from './harness.mjs';
const candidateCommit = 'b4fe4c7868b7ab7067599c6f5d10e99d143aea54';
const baseline = git(baselineCommit, 'src/commands/text.ts').toString();
const candidate = git(candidateCommit, 'src/commands/text.ts').toString();
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const sections = [
  ['exactNumericAndExtraction', 'interface NumericValue', 'async function emitRecords'],
  ['collectionOwnership', 'async function collectSortRecords', 'export function textCommands'],
  ['acceptedUnkeyedCache', '      let compareNumeric = numericCompare;', '      const keyCompare'],
  ['recordCollectionAndEmission', '      const compare = simple', '    define("uniq"'],
];
const unchanged = sections.map(([name, start, end]) => {
  const before = between(baseline, start, end);
  const after = between(candidate, start, name === 'acceptedUnkeyedCache' ? '      let keyCompare' : end);
  assert.ok(before.length > 0);
  assert.equal(before, after, name);
  return { name, sha256: hash(before), bytes: Buffer.byteLength(before), unchanged: true };
});
const delta = execFileSync('git', ['diff', '--name-only', baselineCommit, candidateCommit, '--', 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], { cwd: repo }).toString().trim().split('\n');
const actualSnapshotDeltas = delta.map(path => ({ path, baselineSha256: hash(git(baselineCommit, path)), candidateSha256: hash(git(candidateCommit, path)), intendedSortStage: path === 'src/commands/text.ts' }));
writeFileSync(join(directory, 'actual-source-delta.diff.txt'), execFileSync('git', ['diff', baselineCommit, candidateCommit, '--', 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json'], { cwd: repo }), { flag: 'wx' });
const unchangedContractsAndExports = ['package.json', 'src/index.ts', 'src/contracts/command.ts', 'src/contracts/io.ts', 'src/contracts/filesystem.ts', 'src/commands/internal.ts'].map(path => {
  const before = git(baselineCommit, path), after = git(candidateCommit, path);
  assert.deepEqual(before, after);
  return { path, sha256: hash(before) };
});
json(join(directory, 'source-review.json'), {
  baselineCommit, candidateCommit,
  sourceHashes: { baseline: hash(baseline), candidate: hash(candidate) }, unchanged, unchangedContractsAndExports, actualSnapshotDeltas,
  cache: {
    admission: 'One effective numeric key, excluding effective b/f and global c. Empty key-local flags inherit global flags; nonempty key-local flags replace them. Map construction is inside guard.',
    ownership: 'collectSortRecords copies retained complete records and pending fragments before producer advancement/finalization; concatenation yields owned records. Existing records remain retained by records array for sorting/output. Map key is the same owned record reference, not a new extracted view.',
    extraction: 'keyBytes returns transient Uint8Array.subarray(record). parseNumeric Buffer.from(bytes) copies exactly selected bytes, Latin1-decodes those bytes, and returns whole/fraction strings plus boolean. No selected view or decoded full record is stored in the keyed map.',
    retainedBound: '16384 entries; 1048576 logical retained-string bytes. Each admitted descriptor conservatively charged 6 * selected key byte length + 2. Decoded backing plus normalized strings accounted at two bytes per code unit, with extra zero fallback. Full nonnumeric key suffix included; normalized prefix-only charge rejected.',
    wholeRecordBound: 'Unchanged sort bufferLimit=32*1024*1024 counts each owned record payload plus one delimiter; line buffer same limit. Map merely adds existing-record references. Huge unrelated record suffix remains here, not a second new retained-string charge.',
    excludedCosts: 'Logical bound is not V8 heap/RSS proof. Map/object overhead, input array/object overhead and transient parsing/folding/field arrays are not charged as retained strings. Entry cap bounds descriptor count. No peak-memory or wallclock measurement.',
    fallback: 'At entry saturation or insufficient retained charge, selected bytes are parsed uncached. Prior cache retained unchanged, no eviction and no arbitrary fallback value. parseNumeric exact grammar and compareNumericValues unchanged.',
    cancellationAndEffects: 'Existing pre-read/collection/output signal checks and FsError/diagnostic paths unchanged; keyed miss adds throwIfAborted before extraction. Synchronous sorting does not claim interruptibility by an asynchronous event while JS is executing. No cancellation rollback guarantee.',
  },
  qualification: 'Unrelated committed column/runtime changes included faithfully in actual candidate archive, not overlaid. Sort source delta isolated for operation attribution only. No whole-tree speed attribution or full gate.',
});
