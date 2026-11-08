import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidence = path.dirname(fileURLToPath(import.meta.url));
const baseline = '27a7793526830768484885afba5832bf8bb248b5';
const candidate = '21220b465537bf45ffcfb36740956a69f43bf75e';
const owned = ['src/commands/expr/syntax.ts', 'tests/commands/expr/diagnostics-regression.test.ts', 'tests/commands/expr/diagnostics/cases.ts'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(args) {
  const result = spawnSync('git', args, { cwd: root, timeout: 30000, maxBuffer: 10_000_000 });
  assert.ifError(result.error); assert.equal(result.status, 0); assert.equal(result.signal, null);
  return result.stdout;
}
function filesAt(commit, prefix) { return git(['ls-tree', '-r', '--name-only', commit, '--', prefix]).toString().trim().split('\n').filter(Boolean); }
function sourceInventory(commit) { return filesAt(commit, 'src').sort().map(file => ({ path: file, sha256: sha256(git(['show', `${commit}:${file}`])) })); }
function protect(commit, prefix) {
  return filesAt(commit, prefix).map(file => {
    const hash = sha256(git(['show', `${commit}:${file}`]));
    assert.equal(sha256(fs.readFileSync(path.join(root, file))), hash, file);
    return { path: file, sha256: hash };
  });
}
assert.deepEqual(git(['diff-tree', '--no-commit-id', '--name-only', '-r', candidate]).toString().trim().split('\n').sort(), [...owned].sort());
const currentOwned = owned.map(file => {
  const hash = sha256(git(['show', `${candidate}:${file}`]));
  assert.equal(sha256(fs.readFileSync(path.join(root, file))), hash, file);
  return { path: file, sha256: hash };
});
const baselineInputs = JSON.parse(fs.readFileSync(path.join(evidence, 'baseline27a/inputs-before.json')));
for (const item of currentOwned.filter(item => item.path.startsWith('tests/'))) assert.equal(baselineInputs.files.find(row => row.path === item.path).sha256, item.sha256);
const preserved = [
  { commit: '35aa8054ac0ebc1eacefc7cde63e4706f4c72137', prefix: 'tests/commands/expr-stress/frozen' },
  { commit: '92fe8a6335366b93cbc9a80d61fede69af711444', prefix: 'tests/commands/expr-stress/extension-review/frozen' },
  { commit: baseline, prefix: 'tests/commands/expr' },
  { commit: baseline, prefix: 'src/commands/regex-execution' },
].map(binding => ({ ...binding, files: protect(binding.commit, binding.prefix) }));
const sources = { baseline: sourceInventory(baseline), candidate: sourceInventory(candidate) };
const evidenceFiles = fs.readdirSync(evidence, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
  const file = path.join(entry.parentPath, entry.name);
  return { path: path.relative(evidence, file), sha256: sha256(fs.readFileSync(file)) };
}).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const record = {
  createdAt: new Date().toISOString(), baseline, candidate,
  baselineSeal: git(['rev-parse', '1f24ca26']).toString().trim(),
  actualVirtualLabel: 'expr',
  sourceTree: git(['rev-parse', `${candidate}:src`]).toString().trim(),
  sourceInventorySha256: sha256(JSON.stringify(sources.candidate, null, 2) + '\n'),
  sources, currentOwned,
  baselineToCandidateAllSourcePaths: git(['diff', '--name-status', baseline, candidate, '--', 'src']).toString(),
  preserved,
  preservationLimits: 'Checks original tracked frozen/legacy/shared-regex paths and detects changes/removals, not new additions under their broader directories. Archived build input manifests separately check appended entries outside dist/node_modules.',
  evidenceFiles,
};
fs.writeFileSync(path.join(evidence, 'SEAL.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate, sourceTree: record.sourceTree, sourceInventorySha256: record.sourceInventorySha256, sourceFiles: sources.candidate.length, currentOwned, evidenceFiles: evidenceFiles.length }, null, 2));
