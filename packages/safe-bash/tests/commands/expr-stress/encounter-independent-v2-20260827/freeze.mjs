import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { controls } from './controls.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const relative = posix.relative(root, owned);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
function add(filename, bytes) {
  assert(!existsSync(resolve(owned, filename)), `refuse overwrite ${filename}`);
  const text = bytes.toString();
  assert(text.endsWith('\n'), `patch copy requires terminal newline: ${filename}`);
  const patch = `*** Begin Patch\n*** Add File: ${relative}/${filename}\n${text.slice(0, -1).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [patch], { cwd: root, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(sha256(readFileSync(resolve(owned, filename))), sha256(bytes));
}
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const commit = git('rev-parse', 'HEAD').toString().trim();
const historical = 'tests/commands/expr-stress/sequencing-design-20260827';
const qualified = 'tests/commands/expr-stress/qualified-final-review-20260827';
const originals = [
  ['e9ff18dc', `${historical}/freeze/cases.json`, 'freeze/original-cases.json'],
  ['e9ff18dc', `${historical}/driver.mjs`, 'freeze/original-driver.mjs'],
  ['e9ff18dc', `${historical}/freeze/receipt.json`, 'freeze/original-receipt.json'],
  ['514f8407', `${historical}/baseline-01/product.json`, 'historical/accepted-product.json'],
  ['514f8407', `${historical}/baseline-01/native-semantics.json`, 'historical/native-semantics.json'],
  ['514f8407', `${historical}/baseline-01/native-controls.json`, 'historical/native-controls.json'],
  ['cf5caabe', `${qualified}/sequencing-unchanged.json`, 'historical/qualified-sequencing.json'],
  ['cf5caabe', `${qualified}/sequencing-summary.json`, 'historical/qualified-summary.json'],
];
const provenance = originals.map(([ref, source, destination]) => {
  const bytes = git('show', `${ref}:${source}`);
  add(destination, bytes);
  return { commit: git('rev-parse', ref).toString().trim(), source, destination, sha256: sha256(bytes) };
});
const frozen = JSON.parse(readFileSync(resolve(owned, 'freeze/original-cases.json')));
assert.equal(frozen.cases.length, 61);
assert.equal(sha256(readFileSync(resolve(owned, 'freeze/original-cases.json'))), 'd1892a748a9437fa253735636abf6f8d349c00d4898579d7a8b92bf0a2598314');
const qualifiedCapture = JSON.parse(readFileSync(resolve(owned, 'historical/qualified-sequencing.json')));
const qualifiedResults = JSON.parse(qualifiedCapture.stdout);
assert.equal(qualifiedResults.cases.length, 61);
assert.equal(qualifiedResults.cases.filter(specimen => specimen.passed).length, 42);
for (const [index, specimen] of frozen.cases.entries()) {
  assert.equal(qualifiedResults.cases[index].id, specimen.id);
  assert.deepEqual(qualifiedResults.cases[index].expected, specimen.expected);
}
add('freeze/controls.json', json({ expectationVersion: 'independent-encounter-v2-prefreeze', controls }));
const source = {};
const queue = ['src/commands/expr/index.ts', 'src/commands/expr/internal.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/worker.ts', 'src/shell/shell.ts', 'src/fs/memory/index.ts'];
while (queue.length) {
  const filename = queue.shift();
  if (source[filename] !== undefined) continue;
  const text = git('show', `${commit}:${filename}`).toString();
  source[filename] = text;
  for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/gu)) {
    const dependency = posix.normalize(posix.join(posix.dirname(filename), match[1])).replace(/\.js$/u, '.ts');
    assert(dependency.startsWith('src/') && dependency.endsWith('.ts'), dependency);
    queue.push(dependency);
  }
}
for (const filename of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) source[filename] = git('show', `${commit}:${filename}`).toString();
const ordered = Object.fromEntries(Object.entries(source).sort(([left], [right]) => left.localeCompare(right)));
const sourceBytes = json(ordered);
const compressed = gzipSync(sourceBytes);
add('freeze/source-archive.b64.data', Buffer.from(`${compressed.toString('base64')}\n`));
const sourceManifest = Object.entries(ordered).map(([filename, text]) => ({ filename, sha256: sha256(Buffer.from(text)), liveSha256AtFreeze: sha256(readFileSync(resolve(root, filename))), bytes: Buffer.byteLength(text) }));
add('freeze/source-manifest.json', json(sourceManifest));
add('freeze/manifest.json', json({
  frozenAt: new Date().toISOString(), baselineCommit: commit, sourceSelection: 'Committed static relative-import closure of expr + worker + historical Shell driver; never overlays live edits. Unrelated live edits neither enter nor veto archive.',
  archiveSha256: sha256(compressed), expandedSha256: sha256(sourceBytes), sourceFiles: sourceManifest.length, compressedBytes: compressed.length,
  originalCasesSha256: sha256(readFileSync(resolve(owned, 'freeze/original-cases.json'))), exact61Sha256: sha256(Buffer.from(JSON.stringify(frozen.cases))),
  originalCount: 61, nativeCount: 44, projectCount: 17, nearbyCount: controls.length,
  provenance, newControlsSha256: sha256(readFileSync(resolve(owned, 'freeze/controls.json'))),
  sourceArchiveClassification: 'gzip base64 immutable source data, not canonical TypeScript input',
  historicalProfile: 'Frozen GNU coreutils 9.7 Darwin 25.4.0 arm64, LC_ALL=C. No new native execution, no Linux assumption. New controls are project-policy controls, not independently native-qualified.',
  expectedEvents: { original: 'Byte-identical original-driver.mjs preserves all expected job counts, noEncode checks, shared-budget checks, nonoverlap, abort identity and worker settlement assertions. Historical captures preserve actual events; their nondeterministic timings/exit codes are not new expected events.', nearby: 'One shared Budget and matcher, monotonically decreasing work allowance; exact ordered subjects; zero inactive encoding/jobs; registration before acquisition; all workers closed before execute settlement; repeated concurrent cleanup awaited; sink writes awaited; errno-shaped caller cancellation preserves identity.' },
  inputs: frozen.cases.map(specimen => ({ id: specimen.id, args: specimen.args, environment: specimen.env ?? { LC_ALL: 'C' }, expected: specimen.expected, jobs: specimen.jobs, noEncode: specimen.noEncode ?? [], abort: specimen.abort ?? null, limits: specimen.limits ?? null, sharedBudget: specimen.sharedBudget ?? false })),
}));
console.log(JSON.stringify({ commit, sourceFiles: sourceManifest.length, compressedBytes: compressed.length, exact61Sha256: sha256(Buffer.from(JSON.stringify(frozen.cases))), nearbyCount: controls.length }));
