import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { holdouts, capRecipeNames, baselineCommit, acceptanceCommit, acceptanceHash } from './holdouts.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const markerBytes = readFileSync('/tmp/sort-unkeyed-author-baseline.txt');
const marker = JSON.parse(markerBytes);
assert.equal(marker.commit, baselineCommit);
assert.equal(git(['rev-parse', `${baselineCommit}^{tree}`]).toString().trim(), marker.tree);
const sourceFiles = git(['ls-tree', '-r', '--name-only', baselineCommit, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json']).toString().trim().split('\n');
const sources = sourceFiles.map(path => {
  const bytes = git(['show', `${baselineCommit}:${path}`]);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
for (const file of marker.files) {
  assert.equal(sources.find(source => source.path === file.path).sha256, file.sha256);
  assert.equal(hash(git(['show', `e090f29:${file.path}`])), file.sha256);
}
const priorDirectory = 'benchmarks/reports/sort-performance-next-20260827/';
const acceptanceBytes = git(['show', `${acceptanceCommit}:${priorDirectory}workloads.json`]);
assert.equal(hash(acceptanceBytes), acceptanceHash);
assert.equal(JSON.parse(acceptanceBytes).specimens.length, 21);
const pinned = [
  ...['README.md', 'ACCEPTANCE.md', 'workloads.json', 'inputs.json', 'worker.mjs', 'run.mjs', 'MANIFEST.json'].map(path => ({ commit: acceptanceCommit, path: priorDirectory + path })),
  ...['tests/commands/core-sort/native.json', 'tests/commands/core-sort/regressions.test.ts', 'tests/commands/core-sort/borrowed-buffer.test.ts', 'tests/contracts/io.test.ts', 'benchmarks/reports/sort-performance-independent-20260827/hidden.mjs'].map(path => ({ commit: 'e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64', path })),
].map(file => ({ ...file, sha256: hash(git(['show', `${file.commit}:${file.path}`])) }));
const expected = JSON.stringify({ specimens: holdouts() }, null, 2) + '\n';
const result = {
  created: new Date().toISOString(), baselineCommit, baselineTree: marker.tree,
  originalSourceEqual: true, candidateInspected: false, candidateExecuted: false,
  acceptanceCommit, acceptanceHash, acceptanceCount: 21, holdoutCount: holdouts().length,
  capRecipeCount: capRecipeNames.length, capRecipes: capRecipeNames,
  expectedSha256: hash(expected), holdoutsSha256: hash(readFileSync(directory + 'holdouts.mjs')),
  freezePolicySha256: hash(readFileSync(directory + 'FREEZE.md')), markerSha256: hash(markerBytes),
  pinned, sources,
  preparationAttempts: ['One metadata-only node -e count command had an extra closing parenthesis; no product execution or expectation changes.'],
};
for (const name of ['expected.json', 'baseline-marker.json', 'freeze.json']) assert.equal(existsSync(directory + name), false, `refuse overwrite ${name}`);
writeFileSync(directory + 'expected.json', expected, { flag: 'wx' });
writeFileSync(directory + 'baseline-marker.json', markerBytes, { flag: 'wx' });
writeFileSync(directory + 'freeze.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ acceptanceCount: 21, holdoutCount: result.holdoutCount, capRecipeCount: result.capRecipeCount, expectedSha256: result.expectedSha256, sourceFiles: sources.length }));
