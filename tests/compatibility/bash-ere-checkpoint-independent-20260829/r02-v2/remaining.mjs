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
await check('N02-bulk-work-checkpoint', async () => {
  const ledger = new Ledger(bounds, { work: 20000 });
  const program = await compileEre('a'.repeat(600), ledger);
  assert.deepEqual((await matchEre(program, 'a'.repeat(600), ledger)).values, ['a'.repeat(600)]);
  ledger.finish();
  assert.ok(ledger.bulk.includes(1200));
  assert.equal(ledger.pendingBulk, false);
  assert.ok(ledger.maximumUnitGap <= 256);
  return { bulk: ledger.bulk, gap: ledger.maximumUnitGap, usage: ledger.usage };
});
await check('N03-range-loop-caller-false', async () => {
  const ledger = new Ledger(bounds, { work: 20000 });
  const controller = new AbortController();
  let aborter;
  let stack;
  ledger.observer = () => {
    const here = new Error().stack;
    if (!aborter && ledger.usage.work >= 500 && here.includes('Parser.set')) {
      stack = here;
      aborter = immediate().then(() => controller.abort(false));
    }
  };
  let present = false;
  let caught;
  try { await compileEre(`[${'a-z'.repeat(30)}]`, ledger, controller.signal); }
  catch (reason) { present = true; caught = reason; }
  finally { if (aborter) await aborter; }
  assert.ok(aborter); assert.ok(present); assert.equal(caught, false);
  const usage = ledger.usage; await immediate(); assert.deepEqual(ledger.usage, usage);
  assert.equal(usage.captureSlots, 0);
  return { usage, stack, callerIdentity: true, aborterSettled: true };
});
await check('N04-history-checkpoint-undefined-rejection', async () => {
  class ThrowingLedger extends EreLedger {
    activated = false;
    async checkpoint(signal) {
      await super.checkpoint(signal);
      if (this.usage.work >= 5000 && new Error().stack.includes('historyOrder')) {
        this.activated = true;
        throw undefined;
      }
    }
  }
  const ledger = new ThrowingLedger(bounds, { work: 200000, states: 5000 });
  const program = await compileEre('(a){255}(|)', ledger);
  let present = false; let caught = Symbol('unsettled');
  try { await matchEre(program, 'a'.repeat(255), ledger); }
  catch (reason) { present = true; caught = reason; }
  assert.ok(ledger.activated && present); assert.equal(caught, undefined);
  assert.equal(ledger.usage.captureBytes, 0); assert.equal(ledger.usage.captureSlots, 0);
  return { usage: ledger.usage, exactUndefined: true, qualification: 'trusted ledger checkpoint rejection, not AbortController undefined-reason semantics' };
});
await check('N05-cumulative-compile-work', async () => {
  const ledger = new Ledger(bounds, { work: 600 });
  await compileEre('a'.repeat(80), ledger);
  const first = ledger.usage;
  let caught;
  try { await compileEre('a'.repeat(80), ledger); } catch (reason) { caught = reason; }
  assert.ok(caught instanceof EreProfileLimitError); assert.equal(caught.resource, 'work'); assert.equal(caught.status, 3);
  assert.ok(ledger.usage.work >= first.work && ledger.usage.work <= 600);
  return { first, final: ledger.usage, privateLimit: true };
});
await check('N06-preaborted-zero-before-work-limit', async () => {
  const ledger = new EreLedger(bounds, { work: 1 });
  ledger.charge('work', 1);
  const before = ledger.usage;
  const controller = new AbortController(); controller.abort(0);
  let present = false; let caught;
  try { await compileEre('a', ledger, controller.signal); } catch (reason) { present = true; caught = reason; }
  assert.ok(present); assert.equal(caught, 0); assert.deepEqual(ledger.usage, before);
  return { usage: before, callerZeroBeforePrivateLimit: true };
});
console.log(JSON.stringify({ event: 'results', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));
if (rows.some(row => !row.pass)) process.exitCode = 1;
