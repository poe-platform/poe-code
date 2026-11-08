import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setImmediate as immediate } from 'node:timers/promises';

const [directory, selection = 'all'] = process.argv.slice(2);
const loads = {};
for (const name of ['types','errors','limits','syntax','matcher']) {
  const path = `${directory}/${name}.js`;
  loads[name] = { path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}
console.log(JSON.stringify({ event: 'loaded', execPath: process.execPath, version: process.version, files: loads }));
const { EreLedger } = await import(pathToFileURL(`${directory}/limits.js`));
const { compileEre } = await import(pathToFileURL(`${directory}/syntax.js`));
const { matchEre } = await import(pathToFileURL(`${directory}/matcher.js`));
const { EreProfileLimitError } = await import(pathToFileURL(`${directory}/errors.js`));
const bounds = { maxExpansionBytes: 1048576, maxExpansionFields: 8192 };
class ObservedLedger extends EreLedger {
  units = 0; previous = 0; maximum = 0; calls = 0; observer;
  charge(resource, amount, signal) { super.charge(resource, amount, signal); if (resource === 'work' && amount === 1) this.units++; }
  async checkpoint(signal) {
    this.maximum = Math.max(this.maximum, this.units - this.previous);
    this.previous = this.units; this.calls++;
    this.observer?.();
    await super.checkpoint(signal);
  }
  finish() { this.maximum = Math.max(this.maximum, this.units - this.previous); }
}
const rows = [];
async function check(id, body) {
  if (selection !== 'all' && selection !== id) return;
  try { const detail = await body(); rows.push({ id, pass: true, detail }); }
  catch (error) { rows.push({ id, pass: false, error: String(error?.stack ?? error) }); }
}
const witness = '(a){255}(|)';
const subject = 'a'.repeat(255);
await check('C01', async () => {
  const ledger = new ObservedLedger(bounds, { work: 200000, states: 5000, allocationUnits: 100000 });
  const program = await compileEre(witness, ledger);
  const result = await matchEre(program, subject, ledger); ledger.finish();
  assert.deepEqual(result.values, [subject, 'a', '']);
  assert.deepEqual(result.captures, [{ start: 0, end: 255 }, { start: 254, end: 255 }, { start: 255, end: 255 }]);
  assert.ok(ledger.usage.work >= 65025);
  assert.ok(ledger.maximum <= 256, `charged unit gap ${ledger.maximum}`);
  return { maximumUnitGap: ledger.maximum, calls: ledger.calls, usage: ledger.usage };
});
async function cancellation(reason) {
  const ledger = new ObservedLedger(bounds, { work: 200000, states: 5000, allocationUnits: 100000 });
  const program = await compileEre(witness, ledger);
  const controller = new AbortController(); let aborter; let phase;
  ledger.observer = () => {
    if (!aborter && ledger.usage.work >= 5000) {
      phase = new Error('checkpoint location').stack;
      aborter = immediate().then(() => controller.abort(reason));
    }
  };
  let caught = Symbol('not rejected');
  try { await matchEre(program, subject, ledger, controller.signal); } catch (error) { caught = error; }
  if (aborter) await aborter;
  ledger.finish(); assert.ok(aborter, 'actual checkpoint must schedule the caller abort');
  assert.match(phase, /historyOrder/); assert.equal(caught, reason);
  const usage = ledger.usage; await immediate(); assert.deepEqual(ledger.usage, usage);
  assert.ok(ledger.maximum <= 256);
  return { usage, phase, maximumUnitGap: ledger.maximum };
}
await check('C02', () => cancellation(0));
await check('C03', async () => { const observations = []; for (const reason of [false, '', null]) observations.push(await cancellation(reason)); return observations; });
await check('C04', async () => {
  const ledger = new ObservedLedger(bounds, { work: 100000, states: 5000, allocationUnits: 100000 });
  const program = await compileEre(witness, ledger);
  await matchEre(program, subject, ledger); const first = ledger.usage;
  await assert.rejects(matchEre(program, subject, ledger), error => error instanceof EreProfileLimitError && error.resource === 'work' && error.status === 3);
  assert.equal(ledger.usage.work, 100000); assert.equal(ledger.usage.captureSlots, first.captureSlots);
  assert.ok(first.work > 65025); return { first, final: ledger.usage };
});
await check('C05', async () => {
  const ledger = new ObservedLedger(bounds, { work: 10000 });
  const program = await compileEre(`a{${'0'.repeat(1024)}1}`, ledger);
  assert.deepEqual((await matchEre(program, 'a', ledger)).values, ['a']); ledger.finish();
  assert.ok(ledger.maximum <= 256, `count unit gap ${ledger.maximum}`); return { maximumUnitGap: ledger.maximum, usage: ledger.usage };
});
await check('C06', async () => {
  const ledger = new ObservedLedger(bounds, { work: 20000 });
  const input = 'a'.repeat(1000);
  const program = await compileEre([{ text: input, literal: true }], ledger);
  assert.deepEqual((await matchEre(program, input, ledger)).values, [input]); ledger.finish();
  assert.ok(ledger.maximum <= 256, `fragment/sequence unit gap ${ledger.maximum}`); return { maximumUnitGap: ledger.maximum, usage: ledger.usage };
});
await check('C07', async () => {
  const observations = [];
  for (const pattern of [`[${'a'.repeat(1024)}]`, `[^${'[:digit:]'.repeat(8)}]`]) {
    const ledger = new ObservedLedger(bounds, { work: 10000 });
    const program = await compileEre(pattern, ledger);
    const value = pattern.startsWith('[^') ? 'A' : 'a';
    assert.deepEqual((await matchEre(program, value, ledger)).values, [value]); ledger.finish();
    assert.ok(ledger.maximum <= 256, `bracket unit gap ${ledger.maximum}`); observations.push({ maximumUnitGap: ledger.maximum, usage: ledger.usage });
  }
  return observations;
});
await check('C08', async () => {
  const ledger = new ObservedLedger(bounds, { work: 10000 });
  const controller = new AbortController(); const reason = { caller: 'count-loop' }; let aborter; let phase;
  ledger.observer = () => {
    if (!aborter && ledger.usage.work >= 1500) {
      phase = new Error('checkpoint location').stack;
      aborter = immediate().then(() => controller.abort(reason));
    }
  };
  let caught;
  try { await compileEre(`a{${'0'.repeat(1024)}1}`, ledger, controller.signal); } catch (error) { caught = error; }
  if (aborter) await aborter;
  assert.ok(aborter); assert.match(phase, /Parser.count/); assert.equal(caught, reason);
  return { usage: ledger.usage, phase };
});
console.log(JSON.stringify({ event: 'results', rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));
if (rows.length === 0 || rows.some(row => !row.pass)) process.exitCode = 1;
