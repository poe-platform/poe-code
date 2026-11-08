import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Owner, errors, writeAll, openPair } from './tracked-owner.mjs';
export async function controls(owner, node, root) {
  const rows = [];
  const check = (id, callback) => { callback(); rows.push({ id, outcome: 'PASS', role: 'PURE' }); };
  check('C01-short', () => { let count = 0, charged = 0; writeAll({ writeSync: () => { count++; return 1; } }, 1, Buffer.from('abc'), bytes => { charged += bytes; }); assert.equal(count, 3); assert.equal(charged, 3); });
  check('C02-zero', () => assert.throws(() => writeAll({ writeSync: () => 0 }, 1, Buffer.from('x'), () => {}), /CAPTURE_WRITE/));
  check('C03-second-open-dual', () => { let opened = 0, closed = 0, caught = false; const secondary = []; try { openPair({ openSync: () => { if (++opened === 2) throw 0; return 11; }, closeSync: value => { assert.equal(value, 11); closed++; throw false; } }, ['a', 'b'], value => secondary.push(value)); } catch (reason) { caught = true; assert.equal(reason, 0); } assert(caught); assert.equal(closed, 1); assert.deepEqual(secondary, [false]); });
  check('C04-falsy', () => { for (const reason of [undefined, null, false, 0, '']) { const state = errors(); state.add(reason); state.add(false); assert(state.snapshot().primaryPresent); assert.equal(state.snapshot().primary.type, reason === null ? 'null' : typeof reason); assert.equal(state.snapshot().secondary.length, 1); } });
  check('C05-live-self', () => { const state = owner.snapshot(); assert.equal(state.self.pid, process.pid); assert.equal(state.self.closeObserved, false); assert.equal(state.knownStarts, 1 + state.starts.length); state.self.pid = -1; assert.equal(owner.snapshot().self.pid, process.pid); });
  check('C06-tail', () => { const isolated = new Owner({ ...owner.config, captureLimit: 20, tailBytes: 5 }); isolated.charge(15); assert.throws(() => isolated.charge(1), /BYTE_LIMIT/); isolated.terminal = true; isolated.charge(5); assert.throws(() => isolated.charge(1), /BYTE_LIMIT/); });
  check('C07-clock', () => assert.throws(() => new Owner({ ...owner.config, wallMs: 10, reserveMs: 10 }).check(), /CLOCK/));
  check('C08-postpublication-bytes', () => { const isolated = new Owner(owner.config); isolated.terminal = true; const before = isolated.snapshot(); const receipt = isolated.persist(path.join(owner.config.raw, 'synthetic-tail.json'), { synthetic: true, gitExecuted: false }); assert.equal(isolated.snapshot().metadataBytes - before.metadataBytes, receipt.bytes); });
  const failed = new Owner(owner.config); const result = await failed.run('pure-failed-spawn', node, [], 1000, () => { throw undefined; });
  assert(result.faults.primaryPresent); assert.equal(result.faults.primary.type, 'undefined'); assert.equal(failed.snapshot().knownStarts, 1); assert.equal(result.attempt.spawned, false);
  rows.push({ id: 'C09-failed-spawn', outcome: 'PASS', role: 'PURE_INJECTED_NO_OS_CHILD' });
  await assert.rejects(() => owner.run('unknown', '/not-admitted', []), /UNKNOWN_TOOL/); rows.push({ id: 'C10-unknown-tool', outcome: 'PASS', role: 'PURE_NO_CHILD' });
  for (const [mode, code] of [['ready', 0], ['exit7', 7]]) {
    const result = await owner.run('fixture-' + mode, node, [path.join(root, 'harmless.mjs'), mode], 5000);
    assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, code); assert.equal(result.row.closeCode, code); assert(result.row.stdoutEnd && result.row.stderrEnd);
    assert.equal(fs.readFileSync(result.files[0], 'utf8'), `harmless:${mode}\n`); assert.equal(fs.readFileSync(result.files[1], 'utf8'), 'bounded-stderr\n');
    rows.push({ id: 'C11-' + mode, outcome: 'PASS', role: 'ACTUAL_HARMLESS_NODE', pid: result.row.pid });
  }
  await assert.rejects(() => owner.run('fixture-ready', node, []), /DUPLICATE_ROLE/); rows.push({ id: 'C12-duplicate', outcome: 'PASS', role: 'PURE_NO_CHILD' });
  assert.equal(owner.active.size, 0); return rows;
}
