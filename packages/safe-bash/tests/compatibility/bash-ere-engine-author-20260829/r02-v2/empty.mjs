import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as immediate } from 'node:timers/promises';

const directory = process.argv[2];
const files = {};
for (const name of ['types', 'errors', 'limits', 'syntax', 'matcher']) {
  const filename = join(directory, name + '.js');
  const stat = await lstat(filename);
  assert.ok(stat.isFile() && stat.size <= 1048576);
  files[name] = { sha256: createHash('sha256').update(await readFile(filename)).digest('hex') };
}
console.log(JSON.stringify({ event: 'loaded', execPath: process.execPath, files }));
const { EreLedger } = await import(pathToFileURL(join(directory, 'limits.js')));
const { compileEre } = await import(pathToFileURL(join(directory, 'syntax.js')));
const { matchEre } = await import(pathToFileURL(join(directory, 'matcher.js')));
const { EreProfileLimitError } = await import(pathToFileURL(join(directory, 'errors.js')));
const bounds = { maxExpansionBytes: 1048576, maxExpansionFields: 8192 };
const rows = [];
async function check(id, body) {
  if (process.argv[3] !== 'all' && process.argv[3] !== id) return;
  try { rows.push({ id, pass: true, detail: await body() }); }
  catch (reason) { rows.push({ id, pass: false, reasonPresent: true, error: String(reason?.stack ?? reason) }); }
}
class Ledger extends EreLedger {
  unitGap = 0;
  maximumUnitGap = 0;
  bulk = [];
  pendingBulk = false;
  calls = 0;
  observer;
  charge(resource, amount, signal) {
    super.charge(resource, amount, signal);
    if (resource === 'work') {
      assert.equal(this.pendingBulk, false, 'bulk work must reach its checkpoint before another charge');
      if (amount === 1) this.unitGap++;
      if (amount >= 256) { this.bulk.push(amount); this.pendingBulk = true; }
    }
  }
  async checkpoint(signal) {
    this.maximumUnitGap = Math.max(this.maximumUnitGap, this.unitGap);
    this.unitGap = 0;
    this.pendingBulk = false;
    this.calls++;
    this.observer?.();
    await super.checkpoint(signal);
  }
  finish() { this.maximumUnitGap = Math.max(this.maximumUnitGap, this.unitGap); }
}
await check('N01-empty-fragment-first-pass', async () => {
  const ledger = new Ledger(bounds, { work: 10000 });
  const fragments = Array.from({ length: 2048 }, () => ({ text: '', literal: true }));
  fragments.push({ text: 'a', literal: true });
  const program = await compileEre(fragments, ledger);
  assert.deepEqual((await matchEre(program, 'a', ledger)).values, ['a']);
  ledger.finish();
  assert.ok(ledger.maximumUnitGap <= 256, `empty-fragment charged unit gap ${ledger.maximumUnitGap}`);
  return { gap: ledger.maximumUnitGap, usage: ledger.usage };
});
await check('E02-empty-boundaries', async () => {
  const observations = [];
  for (const count of [0, 255, 256, 257]) {
    const ledger = new Ledger(bounds, { work: 10000 });
    const fragments = Array.from({ length: count }, () => ({ text: '', literal: true }));
    const program = await compileEre(fragments, ledger);
    assert.deepEqual((await matchEre(program, '', ledger)).values, ['']);
    ledger.finish(); assert.ok(ledger.maximumUnitGap <= 256);
    observations.push({ count, usage: ledger.usage, gap: ledger.maximumUnitGap });
  }
  const zero = new Ledger(bounds, { work: 0 });
  await assert.rejects(compileEre([{ text: '', literal: true }], zero), error => error instanceof EreProfileLimitError && error.resource === 'work' && error.status === 3);
  assert.equal(zero.usage.work, 0); assert.equal(zero.usage.allocationUnits, 0);
  return observations;
});
await check('E03-first-pass-caller', async () => {
  const observations = [];
  for (const reason of [0, false]) {
    const ledger = new Ledger(bounds, { work: 10000 });
    const fragments = Array.from({ length: 2048 }, () => ({ text: '', literal: true }));
    fragments.push({ text: 'a', literal: true });
    const controller = new AbortController(); let aborter; let phase;
    ledger.observer = () => {
      if (!aborter && ledger.usage.work >= 256) {
        phase = new Error('phase').stack;
        aborter = immediate().then(() => controller.abort(reason));
      }
    };
    let present = false; let caught;
    try { await compileEre(fragments, ledger, controller.signal); } catch (error) { present = true; caught = error; }
    finally { if (aborter) await aborter; }
    assert.ok(aborter && present); assert.equal(caught, reason); assert.match(phase, /flatten/);
    assert.equal(ledger.usage.work, 256); assert.equal(ledger.usage.allocationUnits, 0); assert.equal(ledger.usage.captureSlots, 0);
    const usage = ledger.usage; await immediate(); assert.deepEqual(ledger.usage, usage);
    observations.push({ usage, reason, phase });
  }
  return observations;
});
await check('E04-empty-cumulative', async () => {
  const ledger = new Ledger(bounds, { work: 600 });
  const fragments = Array.from({ length: 257 }, () => ({ text: '', literal: true }));
  fragments.push({ text: 'a', literal: true });
  await compileEre(fragments, ledger); const first = ledger.usage;
  await compileEre(fragments, ledger); const second = ledger.usage;
  assert.ok(second.work > first.work && first.work >= 258);
  await assert.rejects(compileEre(fragments, ledger), error => error instanceof EreProfileLimitError && error.resource === 'work' && error.status === 3);
  assert.equal(ledger.usage.work, 600); assert.equal(ledger.usage.captureSlots, 0);
  return { first, second, final: ledger.usage };
});
console.log(JSON.stringify({ event: 'results', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));
if (rows.length === 0 || rows.some(row => !row.pass)) process.exitCode = 1;
