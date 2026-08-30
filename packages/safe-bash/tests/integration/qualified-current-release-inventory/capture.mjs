import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const [label, requested] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/u); assert.ok(requested);
const input = resolve(requested), allowed = join(repo, 'tests/plugins/qualified-current-release/.runs/');
assert.ok(input.startsWith(allowed));
const output = join(own, 'evidence', label); mkdirSync(output, { recursive: true });
assert.equal(existsSync(join(output, 'summary.json')), false);
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32000000 });
const result = JSON.parse(readFileSync(join(input, 'result.json')));
const source = result.sourceCommit;
for (const entry of readdirSync(input, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.json')) {
  const target = join(output, entry.name);
  if (existsSync(target)) assert.equal(sha(readFileSync(target)), sha(readFileSync(join(input, entry.name))), 'refuse differing existing capture');
  else cpSync(join(input, entry.name), target, { errorOnExist: true, force: false });
}
const historicalEvidenceCommit = 'aae2babf0a03e9b81914a804aee25600eed90fef';
const original = JSON.parse(git(['show', `${historicalEvidenceCommit}:tests/plugins/time-env-public/evidence/release-inventory.json`])).rows.find(row => row.commit.startsWith('6ffe4f4'));
const inventory = JSON.parse(git(['show', `${source}:tests/plugins/qualified-current-release/inventory.json`]));
const originalRows = original.unclassified.map(row => ({ ...row, current: inventory.entries.find(entry => entry.path === row.path) }));
assert.equal(originalRows.length, 20);
for (const row of originalRows) assert.equal(row.sha256, row.current.sha256);
const originalCounts = {};
for (const row of originalRows) originalCounts[row.current.classification] = (originalCounts[row.current.classification] ?? 0) + 1;
assert.deepEqual(originalCounts, { 'frozen-evidence': 12, 'negative-types': 2, current: 6 });
const summary = {
  source, exitCode: result.exitCode, startedAt: result.startedAt, finishedAt: result.finishedAt,
  sourceTreeSha256: result.sourceTreeSha256, archiveSha256: result.archiveSha256,
  harnessSha256: result.harnessSha256, rootReadmeSha256: sha(git(['show', `${source}:README.md`])),
  sourceDeltaFromPublicCandidate: git(['diff', '--name-status', '6ffe4f4', source, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']).toString(),
  historicalEvidenceCommit, originalCounts, originalRows, census: inventory.counts,
  laterPaths: inventory.entries.filter(entry => !originalRows.some(row => row.path === entry.path) && entry.path.includes('release-timestamp-independent')),
  consumerGroups: result.currentConsumers.groups.map(group => ({ name: group.name, inputs: group.inputs, compile: group.compile, runtime: group.runtimeResults, qualification: group.qualification, error: group.error })),
  negativeTypes: result.currentConsumers.negativeTypes,
  sourceUnchanged: result.sourceUnchanged, testsUnchanged: result.testsUnchanged, rootDistUnchanged: result.rootDistUnchanged,
  metadata: result.metadata, archive: result.archive,
  stream: result.stream && { summary: result.stream.summary, diagnostics: result.stream.diagnosticSummary },
  packages: result.packs?.map(pack => ({ sha256: pack.sha256, integrity: pack.metadata.integrity, containsReadme: pack.metadata.files.some(file => file.path === 'README.md') })),
  scope: 'bounded qualified profile/current consumers only; never whole-suite or deployed-service acceptance; configuration author run requires a different verifier',
};
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, source, exitCode: result.exitCode, groups: summary.consumerGroups.length, originalCounts, packages: summary.packages }));
