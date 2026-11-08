import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { artifact, digest, root, snapshot } from './common.mjs';

export const prefix = 'tests/commands/structured-stress/';
export const proposal = `${prefix}jq-grammar-canonical-plan/`;
export const manifest = JSON.parse(readFileSync(join(root, proposal, 'patch-manifest-v3.json')));
export function inventory() {
  const files = {};
  function walk(path) {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const local = relative(root, child);
      if (local.startsWith(`${prefix}jq-grammar-final-review`)) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files[local] = digest(readFileSync(child));
      else assert.fail(`nonregular evidence ${local}`);
    }
  }
  for (const path of ['tests/commands/structured', 'tests/commands/structured-stress', 'dist']) walk(join(root, path));
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}
export function preservation(phase) {
  assert.ok(['pre', 'native', 'post'].includes(phase));
  const baseline = JSON.parse(readFileSync(new URL('pre-approval-audit.json', import.meta.url)));
  const current = inventory();
  const changes = [];
  const derivedChanges = [];
  for (const path of new Set([...Object.keys(baseline.inventory), ...Object.keys(current)])) {
    if (current[path] === baseline.inventory[path]) continue;
    if (path.startsWith('dist/')) {
      derivedChanges.push({ path, beforeSha256: baseline.inventory[path] ?? null, afterSha256: current[path] ?? null });
      continue;
    }
    const file = manifest.files.find(file => file.path === path);
    assert.ok(file, `unapproved fixture/artifact change: ${path}`);
    assert.ok(phase === 'post' || (phase === 'native' && file.patch === 'native'), path);
    assert.equal(baseline.inventory[path] ?? null, file.beforeSha256, path);
    assert.equal(current[path], file.afterSha256, path);
    changes.push({ path, beforeSha256: file.beforeSha256, afterSha256: current[path], patch: file.patch });
  }
  assert.equal(changes.length, phase === 'pre' ? 0 : phase === 'native' ? 12 : 13);
  for (const file of manifest.files) {
    const applied = phase === 'post' || (phase === 'native' && file.patch === 'native');
    assert.equal(current[file.path] ?? null, applied ? file.afterSha256 : file.beforeSha256, file.path);
    if (file.beforeSnapshot) assert.equal(digest(readFileSync(join(root, file.beforeSnapshot))), file.beforeSha256);
    assert.equal(digest(readFileSync(join(root, file.afterSnapshot))), file.afterSha256);
  }
  return { at: new Date().toISOString(), phase, baselineFiles: Object.keys(baseline.inventory).length, currentFiles: Object.keys(current).length,
    unchanged: Object.keys(baseline.inventory).length - changes.filter(change => change.beforeSha256 !== null).length - derivedChanges.filter(change => change.beforeSha256 !== null).length,
    changes, derivedChanges, source: snapshot(), scope: 'All structured canonical tests and historical artifacts: only manifest-approved deltas allowed. Unowned derived dist is separately inventoried, not frozen evidence; late-derived-output-drift.json preserves the first overbroad guard failure. No reviewer command writes dist. Other workers may move unrelated product files; source/tooling snapshots remain separate. Endpoint checks are not ABA guarantees.' };
}
if (process.argv[1]?.endsWith('/preservation.mjs')) {
  const [phase, label] = process.argv.slice(2);
  const result = preservation(phase);
  artifact(`${label}.json`, result);
  console.log(phase, 'exact approved test deltas; other structured evidence unchanged; separately observed derived changes:', result.derivedChanges.length);
}
