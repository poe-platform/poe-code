import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash, git, json } from './artifacts.mjs';
import { cases, frozenRoot } from './plan.mjs';
import { checkpoints } from './procedures.mjs';

export function verifyInputs(repository) {
  const prefix = 'tests/shell/dotglob-independent-20260828/';
  const originals = [
    ['429766aaa9fee0be469ed79b186bc8e3b3ed43c2', ''],
    ['deced72dde70151b1b090fbba7d739323491cd89', 'byte-overlay-v1/'],
  ];
  const checked = [];
  for (const [revision, subdir] of originals) {
    const sealBytes = git(repository, ['show', `${revision}:${prefix}${subdir}SEAL.json`]);
    assert.deepEqual(readFileSync(join(frozenRoot, subdir, 'SEAL.json')), sealBytes, 'historical seal unchanged');
    const seal = JSON.parse(sealBytes);
    for (const [name, expected] of Object.entries(seal)) {
      const bytes = git(repository, ['show', `${revision}:${prefix}${subdir}${name}`]);
      assert.equal(hash(bytes), expected);
      assert.deepEqual(readFileSync(join(frozenRoot, subdir, name)), bytes, `original preserved ${name}`);
      checked.push({ revision, path: `${subdir}${name}`, sha256: expected });
    }
  }
  const plan = cases();
  assert.deepEqual(Object.keys(checkpoints), plan.procedures.map(row => row.id));
  for (const row of plan.overlay) {
    if (row.exitCode === 2) {
      assert.equal(row.stdout, ''); assert.equal(row.postState, row.initial);
      assert.equal(row.stderr, 'shell: line 1: shopt: -z: unsupported option\nshopt: usage: shopt [-pqsu] [--] [dotglob ...]\n');
    } else {
      assert.equal(row.exitCode, 1); assert.equal(row.postState, 'on');
      assert.equal(row.stderr, 'shell: line 1: shopt: -sz: unsupported shell option name (only dotglob is supported)\n');
    }
  }
  const held = json(new URL('./HELD.json', import.meta.url));
  assert.equal(held.acceptedStack, null); assert.equal(held.candidate, null);
  return { checked, counts: Object.fromEntries(Object.entries(plan).map(([name, rows]) => [name, rows.length])), nativeCalls: 0, productExecutions: 0, builds: 0, typeCompilations: 0 };
}
