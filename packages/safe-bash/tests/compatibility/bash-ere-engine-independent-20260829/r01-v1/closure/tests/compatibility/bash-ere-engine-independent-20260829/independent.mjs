import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setImmediate as immediate } from 'node:timers/promises';
const [directory] = process.argv.slice(2);
const { EreLedger, deriveEreLimits } = await import(pathToFileURL(`${directory}/limits.js`).href);
const { compileEre } = await import(pathToFileURL(`${directory}/syntax.js`).href);
const { matchEre } = await import(pathToFileURL(`${directory}/matcher.js`).href);
const { EreProfileLimitError, EreUsageUnknownError } = await import(pathToFileURL(`${directory}/errors.js`).href);
const bounds = { maxExpansionBytes: 1048576, maxExpansionFields: 8192 };
const rows = [];
const check = async (id, body) => {
  try { await body(); rows.push({ id, pass: true }); }
  catch (error) { rows.push({ id, pass: false, message: String(error?.stack ?? error), actual: error?.actual, expected: error?.expected }); }
};
const result = async (pattern, subject) => {
  const ledger = new EreLedger(bounds);
  return matchEre(await compileEre(pattern, ledger), subject, ledger);
};
const vector = async (pattern, subject, expected) => {
  const observed = await result(pattern, subject);
  console.log(JSON.stringify({ event: 'observation', pattern, subject, observed, expected }));
  assert.equal(observed.matched, true);
  assert.deepEqual(observed.captures.map(span => span === null ? null : [span.start, span.end]), expected);
};
await check('I01-parent-optional-reset', () => vector('(a(b)?)+', 'aba', [[0,3],[2,3],null]));
await check('I02-parent-alternative-reset', () => vector('((a)|(b))+', 'ab', [[0,2],[1,2],null,[1,2]]));
await check('I03-nested-parent-reset', () => vector('((a(b)?)c)+', 'abcac', [[0,5],[3,5],[3,4],null]));
await check('I04-manual-example', () => vector('(ba(na)*s )*', 'bananas bas ', [[0,12],[8,12],null]));
await check('I05-finite-parent-reset', () => vector('(a(b)?){2}', 'aba', [[0,3],[2,3],null]));
await check('I06-parent-zero-iteration', () => vector('((a)?b){2}', 'abb', [[0,3],[2,3],null]));
await check('I07-empty-is-participation', () => vector('((a*)b){2}', 'abb', [[0,3],[2,3],[2,2]]));
await check('I08-whole-subexpression-priority', () => vector('(a|aa)(a?)', 'aa', [[0,2],[0,2],[2,2]]));
await check('I09-left-subexpression-priority', () => vector('(a*)(a*)', 'aaa', [[0,3],[0,3],[3,3]]));
await check('I10-original-subject-anchors', () => vector('^b|a$', 'aba', [[2,3]]));
await check('I11-last-iteration-not-largest', () => vector('(a+X)+', 'aaXaX', [[0,5],[3,5]]));
await check('I12-nested-last-iteration', () => vector('(a(b|bb))+', 'abbab', [[0,5],[3,5],[4,5]]));
await check('I13-empty-priority', () => vector('(a?)(a?)', 'a', [[0,1],[0,1],[1,1]]));
await check('I14-nullable-refusal', async () => {
  for (const pattern of ['(a*){2}', '(a?)+', '((a?)b?)*']) await assert.rejects(result(pattern, 'a'), error => error.name === 'EreUnsupportedError' && error.status === 2);
});
await check('I15-intervals', async () => {
  for (const pattern of ['a{2,1}', 'a{,2}', 'a{1']) await assert.rejects(result(pattern, 'a'), error => error.name === 'EreSyntaxError' && error.status === 2);
  await assert.rejects(result('a{256}', ''), error => error.name === 'EreUnsupportedError');
  assert.equal((await result('a{0,255}', 'aaa')).values[0], 'aaa');
});
await check('I16-ascii-refusals', async () => {
  for (const subject of ['\0', '\ud800', 'é']) await assert.rejects(result('.', subject), error => error.name === 'EreUnsupportedError' && error.status === 2);
  assert.equal((await result('[[:cntrl:]]', '\x7f')).matched, true);
  assert.equal((await result('[[:graph:]]', ' ')).matched, false);
});
await check('I17-all-captures', async () => {
  const observed = await result('(a)'.repeat(32), 'a'.repeat(32));
  assert.equal(observed.captures.length, 33);
  for (let index = 1; index <= 32; index++) assert.deepEqual(observed.captures[index], { start: index-1, end:index });
  await assert.rejects(result('(a)'.repeat(33), 'a'.repeat(33)), error => error.name === 'EreUnsupportedError');
});
await check('I18-saturating-formulas', () => {
  const values = [0,1,255,256,31249,31250,499999,500000,1562499,1562500,Number.MAX_SAFE_INTEGER];
  const cap = (value, limit) => Number(value < BigInt(limit) ? value : BigInt(limit));
  for (const bytes of values) for (const fields of values) {
    const observed = deriveEreLimits({ maxExpansionBytes: bytes, maxExpansionFields: fields });
    assert.deepEqual(observed, { patternBytes: Math.min(bytes,65536), subjectBytes: Math.min(bytes,1048576), work:cap(BigInt(bytes)*32n,50000000), states:cap(BigInt(fields)*8n,65536), allocationUnits:cap(BigInt(bytes)*8n+BigInt(fields)*128n,4000000), captureBytes:bytes, captureSlots:fields });
  }
});
await check('I19-cumulative-no-refund', async () => {
  const ledger = new EreLedger(bounds, { captureSlots: 2 });
  const program = await compileEre('a', ledger);
  await matchEre(program, 'a', ledger);
  const before = ledger.usage;
  await matchEre(program, 'a', ledger);
  await assert.rejects(matchEre(program, 'a', ledger), error => error instanceof EreProfileLimitError && error.resource === 'captureSlots' && error.status === 3);
  const after = ledger.usage;
  for (const key of Object.keys(before)) assert.ok(after[key] >= before[key]);
  assert.equal(after.captureSlots, 2);
  assert.equal(after.subjectBytes, 1);
  assert.equal(after.patternBytes, 1);
  assert.equal(after.captureBytes, 2);
});
await check('I20-poison-caller-identity', async () => {
  for (const reason of [0,false,null,'cancelled',{ token: 1 }]) {
    const ledger = new EreLedger(bounds);
    const cause = { lost: true }; ledger.markUnknownUsage(cause);
    await assert.rejects(compileEre('a', ledger), error => error instanceof EreUsageUnknownError && error.cause === cause);
    const controller = new AbortController(); controller.abort(reason);
    let caught = Symbol('not caught');
    try { await compileEre('a', ledger, controller.signal); } catch (error) { caught = error; }
    assert.equal(caught, reason);
    assert.equal(ledger.usage.work, 0);
  }
});
await check('I21-cooperative-cancel', async () => {
  const ledger = new EreLedger(bounds);
  const program = await compileEre('(a|aa)+b', ledger);
  const controller = new AbortController(); const reason = { stop: true };
  const active = matchEre(program, 'a'.repeat(22), ledger, controller.signal);
  const cancel = immediate().then(() => controller.abort(reason));
  let caught; try { await active; } catch (error) { caught = error; }
  await cancel;
  assert.equal(caught, reason);
  const usage = ledger.usage;
  await immediate(); assert.deepEqual(ledger.usage, usage);
});
await check('I22-integer-boundaries-errors', () => {
  const ledger = new EreLedger({ maxExpansionBytes: Number.MAX_SAFE_INTEGER, maxExpansionFields: Number.MAX_SAFE_INTEGER });
  ledger.charge('captureBytes', Number.MAX_SAFE_INTEGER);
  assert.throws(() => ledger.charge('captureBytes', 1), error => error instanceof EreProfileLimitError && error.name !== 'ShellLimitError' && error.status === 3);
  assert.equal(ledger.usage.captureBytes, Number.MAX_SAFE_INTEGER);
  for (const amount of [-1,NaN,Infinity,0.1,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => ledger.charge('work', amount), TypeError);
  assert.equal(ledger.usage.work, 0);
});
await check('I23-finite-reset-property', async () => {
  const failures = []; let checked = 0;
  for (let length = 1; length <= 5; length++) for (let bits = 0; bits < 2 ** length; bits++) {
    const subject = bits.toString(2).padStart(length,'0').replaceAll('0','a').replaceAll('1','b');
    const observed = await result('((a)|(b))+', subject);
    const last = { start:length-1,end:length };
    const expected = [{ start:0,end:length },last,subject.endsWith('a')?last:null,subject.endsWith('b')?last:null];
    checked++;
    if (JSON.stringify(observed.captures) !== JSON.stringify(expected)) failures.push({ subject, observed:observed.captures, expected });
  }
  console.log(JSON.stringify({ event:'property', checked, failures }));
  assert.equal(checked,62); assert.deepEqual(failures,[]);
});
await check('I24-handle-and-result-ownership', async () => {
  const ledger = new EreLedger(bounds); const program = await compileEre('(a)', ledger);
  await assert.rejects(matchEre(program,'a',new EreLedger(bounds)), TypeError);
  await assert.rejects(matchEre({pattern:'(a)',groups:1},'a',ledger), TypeError);
  const observed = await matchEre(program,'a',ledger);
  for (const value of [program,observed,observed.captures,observed.values,...observed.captures]) assert.ok(Object.isFrozen(value));
});
console.log(JSON.stringify({ event:'results', rows, pass:rows.filter(row=>row.pass).length, fail:rows.filter(row=>!row.pass).length }));
if (rows.length !== 24 || rows.some(row=>!row.pass)) process.exitCode = 1;
