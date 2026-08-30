import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const original = 'tests/commands/expr-stress/diagnostics-review';
const owned = 'tests/commands/expr-stress/diagnostics-candidate-review';
const commit = '1231700a9f049262235759bbf07f58b939ae646b';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
function put(path, bytes) {
  assert(path.startsWith(`${owned}/`) && !existsSync(path));
  const text = typeof bytes === 'string' ? bytes : `${JSON.stringify(bytes, null, 2)}\n`;
  const result = spawnSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const names = git('ls-tree', '-r', '-z', '--name-only', commit, '--', original).toString().split('\0').filter(Boolean);
const selected = names.filter(path => path.endsWith('.mjs') && !['prepare.mjs', 'bind-harness.mjs', 'finalize.mjs'].includes(path.slice(original.length + 1)) || path.startsWith(`${original}/freeze/`) || path.endsWith('/inputs.json') || path.endsWith('/legacy-plan.json') || path.endsWith('/devdeps-authentication.json'));
const bindings = [];
for (const path of selected) {
  const bytes = git('show', `${commit}:${path}`);
  assert.deepEqual(readFileSync(path), bytes);
  let bound = bytes.toString();
  const deltas = [];
  const replacements = path.endsWith('.mjs') ? [[original, owned], ['acceptance-27a77935', 'acceptance-diagnostics']] : [];
  if (path.endsWith('/stage.mjs')) replacements.push([`${owned}/freeze/baseline-source.txt`, '/tmp/expr-cdiagnostics-candidate.txt']);
  for (const [from, to] of replacements) if (bound.includes(from)) {
    deltas.push({ from, to, occurrences: bound.split(from).length - 1 });
    bound = bound.replaceAll(from, to);
  }
  const destination = path.replace(original, owned);
  put(destination, bound);
  assert.equal(hash(readFileSync(destination)), hash(bound));
  bindings.push({ original: `${commit}:${path}`, destination, originalSha256: hash(bytes), boundSha256: hash(bound), deltas });
}
put(`${owned}/bindings.json`, { commit, candidate: '21220b465537bf45ffcfb36740956a69f43bf75e', authorEvidence: '7fc76f3917a38c0cc39d46c02383c947fa3ac110', independentFreeze: 'd0fb3ef0bc9c3c04cae829a47454c10e565ad971', bindings });
console.log(JSON.stringify({ copied: bindings.length, expectationsChanged: false }));
