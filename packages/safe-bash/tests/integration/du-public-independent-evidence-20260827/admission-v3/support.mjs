import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export function expectedTree(files, safeRelative) {
  const records = new Map();
  for (const file of files) {
    safeRelative(file.path);
    assert.equal(file.type, 'file', 'fresh input must be regular');
    assert.ok(!records.has(file.path), 'duplicate fresh file');
    records.set(file.path, file);
    let parent = dirname(file.path);
    while (parent !== '.') {
      safeRelative(parent);
      const existing = records.get(parent);
      assert.ok(!existing || existing.type === 'directory');
      records.set(parent, { path: parent, mode: 0o755, type: 'directory' });
      parent = dirname(parent);
    }
  }
  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export function freshGuard(actual, expected, safeRelative) {
  for (const record of actual) {
    safeRelative(record.path);
    assert.ok(record.type === 'file' || record.type === 'directory', 'fresh symlink/nonregular entry');
  }
  assert.deepEqual(actual, expected, 'complete fresh tree: names, modes, hashes, types, sizes');
}

export function focusedControls({ work, inventory, inventoryGuard, safeRelative, census, sha256, state, event, receipt, phase }) {
  state.focusedControls = [];
  const fixture = join(work, 'focused-fixture');
  const baseline = [{ path: 'input.bin', mode: 0o644, type: 'file', bytes: 4, sha256: sha256('base') }];
  function reject(id, mapping, operation) {
    phase(id);
    let error;
    try { operation(); } catch (caught) { error = caught; }
    const record = { id, mapping, rejected: Boolean(error), message: error?.message ?? null, status: error ? 'PASS-negative-only' : 'FAIL' };
    state.focusedControls.push(record);
    event({ kind: 'focused-negative-receipt', ...record });
    receipt();
    assert.ok(error, `${id} did not reject`);
  }
  let unlistedReads = 0;
  reject('N01', 'A03/unlisted-input', () => inventoryGuard([...inventory, { ...inventory[0], path: 'unlisted-input' }], inventory, () => { unlistedReads++; return Buffer.alloc(0); }));
  assert.equal(unlistedReads, 0, 'unlisted rejection must precede content access');
  mkdirSync(fixture, { recursive: true, mode: 0o755 });
  const filename = join(fixture, 'input.bin');
  writeFileSync(filename, 'base', { mode: 0o644, flag: 'wx' });
  try {
    freshGuard(census(fixture), baseline, safeRelative);
    mkdirSync(join(fixture, 'unexpected-directory'), { mode: 0o755 });
    reject('N02', 'A05/new-entry; actual fresh directory', () => freshGuard(census(fixture), baseline, safeRelative));
    rmSync(join(fixture, 'unexpected-directory'), { recursive: true });
    chmodSync(filename, 0o755);
    reject('N03', 'A03/mode; actual fresh file', () => freshGuard(census(fixture), baseline, safeRelative));
    chmodSync(filename, 0o644);
    writeFileSync(filename, 'edit');
    reject('N04', 'A03/hash; actual fresh file', () => freshGuard(census(fixture), baseline, safeRelative));
    writeFileSync(filename, 'base');
    let reads = 0;
    reject('N05', 'overlay/AGENTS metadata before read or write', () => inventoryGuard([{ ...inventory[0], path: 'AGENTS.md' }, ...inventory.slice(1)], inventory, () => { reads++; return Buffer.alloc(0); }));
    assert.equal(reads, 0, 'AGENTS rejection must precede content access');
    event({ kind: 'AGENTS-metadata-only', contentReads: reads, materialized: false, originalMissingPathReconstructed: false });
    symlinkSync('input.bin', join(fixture, 'alias'));
    reject('N06', 'A03/symlink; actual fresh fixture, never followed', () => census(fixture));
    rmSync(join(fixture, 'alias'));
    freshGuard(census(fixture), baseline, safeRelative);
  } finally {
    rmSync(fixture, { recursive: true });
  }
}

export function postAudit(checks, save) {
  const results = [];
  for (const [name, operation] of checks) {
    try { operation(); results.push({ name, status: 'PASS' }); }
    catch (error) { results.push({ name, status: 'FAIL', message: error.message }); }
    save('post-audit-receipts.json', results);
  }
  return results;
}
