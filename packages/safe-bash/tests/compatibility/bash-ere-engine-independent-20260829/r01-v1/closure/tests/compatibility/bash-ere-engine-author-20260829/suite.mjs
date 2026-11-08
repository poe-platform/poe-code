import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';

const [directory, casesFile, selection = 'all'] = process.argv.slice(2);
const loaded = {};
for (const name of ['types', 'errors', 'limits', 'syntax', 'matcher']) {
  const location = `${directory}/${name}.js`;
  loaded[name] = { url: pathToFileURL(location).href, sha256: createHash('sha256').update(await readFile(location)).digest('hex') };
}
console.log(JSON.stringify({ event: 'loaded', execPath: process.execPath, version: process.version, files: loaded }));
const { EreLedger, deriveEreLimits } = await import(loaded.limits.url);
const { compileEre } = await import(loaded.syntax.url);
const { matchEre } = await import(loaded.matcher.url);
const { EreProfileLimitError, EreUsageUnknownError } = await import(loaded.errors.url);
const cases = JSON.parse(await readFile(casesFile, 'utf8'));
const bounds = { maxExpansionBytes: 1_048_576, maxExpansionFields: 8192 };
const rows = [];
async function check(id, body) {
  try { await body(); rows.push({ id, pass: true }); }
  catch (error) { rows.push({ id, pass: false, name: error?.name, message: String(error?.stack ?? error) }); }
}
for (const fixture of cases) {
  if (selection !== 'all' && selection !== fixture.id) continue;
  await check(fixture.id, async () => {
    const ledger = new EreLedger(bounds);
    if (fixture.error) {
      await assert.rejects(async () => matchEre(await compileEre(fixture.pattern, ledger), fixture.subject, ledger), error => error.name === fixture.error && error.status === 2);
      return;
    }
    const result = await matchEre(await compileEre(fixture.pattern, ledger), fixture.subject, ledger);
    assert.equal(result.matched, fixture.values !== null);
    if (fixture.values !== null) assert.deepEqual(result.values, fixture.values);
    if (fixture.spans) assert.deepEqual(result.captures.map(span => span === null ? null : [span.start, span.end]), fixture.spans);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.captures), true);
  });
}
if (selection === 'all') {
  await check('L01-safe-derivation', () => {
    const huge = deriveEreLimits({ maxExpansionBytes: Number.MAX_SAFE_INTEGER, maxExpansionFields: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(huge, { patternBytes: 65536, subjectBytes: 1048576, work: 50000000, states: 65536, allocationUnits: 4000000, captureBytes: Number.MAX_SAFE_INTEGER, captureSlots: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(Object.values(deriveEreLimits({ maxExpansionBytes: 0, maxExpansionFields: 0 })), [0,0,0,0,0,0,0]);
    for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => deriveEreLimits({ maxExpansionBytes: value, maxExpansionFields: 1 }), TypeError);
    assert.throws(() => new EreLedger(bounds, { work: 50000001 }), RangeError);
  });
  await check('L02-no-refund', async () => {
    const ledger = new EreLedger(bounds, { work: 5 });
    await assert.rejects(compileEre('abcdef', ledger), error => error instanceof EreProfileLimitError && error.resource === 'work' && error.status === 3);
    assert.equal(ledger.usage.work, 5);
    await assert.rejects(compileEre('a', ledger), error => error.resource === 'work');
  });
  await check('L03-poison-and-reason', async () => {
    const ledger = new EreLedger(bounds);
    const reason = { unknown: 'lost worker receipt (synthetic only)' };
    ledger.markUnknownUsage(reason);
    await assert.rejects(compileEre('a', ledger), error => error instanceof EreUsageUnknownError && error.cause === reason);
    const control = new AbortController(); control.abort(0);
    let observed = 'unset'; try { await compileEre('a', ledger, control.signal); } catch (error) { observed = error; }
    assert.equal(observed, 0);
  });
  await check('L04-seven-limits', async () => {
    for (const resource of ['patternBytes', 'work', 'allocationUnits']) {
      const ledger = new EreLedger(bounds, { [resource]: 0 });
      await assert.rejects(compileEre('a', ledger), error => error instanceof EreProfileLimitError && error.resource === resource);
    }
    for (const resource of ['subjectBytes', 'states', 'captureBytes', 'captureSlots']) {
      const ledger = new EreLedger(bounds, { [resource]: 0 });
      const program = await compileEre('a', ledger);
      await assert.rejects(matchEre(program, 'a', ledger), error => error instanceof EreProfileLimitError && error.resource === resource);
    }
  });
  await check('L05-boundary-storage', async () => {
    const ledger = new EreLedger(bounds, { captureBytes: 2, captureSlots: 2 });
    const program = await compileEre('(a)', ledger);
    assert.deepEqual((await matchEre(program, 'a', ledger)).values, ['a', 'a']);
    await assert.rejects(matchEre(program, 'a', ledger), error => error.resource === 'captureSlots');
    assert.equal(ledger.usage.captureBytes, 2);
  });
  await check('L06-binding-refusal', async () => {
    const ledger = new EreLedger(bounds);
    const program = await compileEre('a', ledger);
    await assert.rejects(matchEre(program, 'a', new EreLedger(bounds)), TypeError);
    await assert.rejects(matchEre({ ...program }, 'a', ledger), TypeError);
  });
  await check('L07-grammar-bounds', async () => {
    await assert.rejects(compileEre('('.repeat(33) + 'a' + ')'.repeat(33), new EreLedger(bounds)), error => error.name === 'EreUnsupportedError' && error.message.includes('32-group'));
    await assert.rejects(compileEre('a'.repeat(4096), new EreLedger(bounds)), error => error.name === 'EreUnsupportedError' && error.message.includes('4096-node'));
    const ledger = new EreLedger(bounds);
    assert.equal((await matchEre(await compileEre('a{255}', ledger), 'a'.repeat(255), ledger)).values[0].length, 255);
  });
  await check('L08-preabort-identities', async () => {
    for (const reason of [false, 0, '', null, { sentinel: 1 }]) {
      const controller = new AbortController(); controller.abort(reason);
      let caught = Symbol();
      try { await compileEre('(', new EreLedger(bounds), controller.signal); } catch (error) { caught = error; }
      assert.equal(caught, reason);
    }
  });
  await check('L09-cooperative-cancel', async () => {
    const ledger = new EreLedger(bounds);
    const program = await compileEre('(a|aa)+b', ledger);
    const controller = new AbortController(); const reason = { cancelled: true };
    const work = matchEre(program, 'a'.repeat(24), ledger, controller.signal);
    const aborter = immediate().then(() => controller.abort(reason));
    let caught; try { await work; } catch (error) { caught = error; }
    await aborter;
    assert.equal(caught, reason);
    const usage = ledger.usage.work;
    await immediate(); assert.equal(ledger.usage.work, usage);
  });
  await check('L10-bounded-ambiguity', async () => {
    const ledger = new EreLedger(bounds, { work: 2000 });
    const program = await compileEre('(a|aa)+b', ledger);
    await assert.rejects(matchEre(program, 'a'.repeat(18), ledger), error => error.resource === 'work');
    assert.equal(ledger.usage.work, 2000);
  });
  await check('L11-shared-interleaving', async () => {
    const ledger = new EreLedger(bounds, { captureSlots: 1 });
    const program = await compileEre('a', ledger);
    const results = await Promise.allSettled([matchEre(program, 'a', ledger), matchEre(program, 'a', ledger)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.resource === 'captureSlots').length, 1);
  });
  await check('P01-literal-search-155', async () => {
    const subjects = ['', 'a', 'b', 'aa', 'ab', 'ba', 'bb', 'aaa', 'aab', 'aba', 'abb', 'baa', 'bab', 'bba', 'bbb', 'aaaa', 'aaab', 'aaba', 'aabb', 'abaa', 'abab', 'abba', 'abbb', 'baaa', 'baab', 'baba', 'babb', 'bbaa', 'bbab', 'bbba', 'bbbb'];
    for (const pattern of ['', 'a', 'b', 'ab', 'ba']) for (const subject of subjects) {
      const ledger = new EreLedger(bounds);
      const result = await matchEre(await compileEre(pattern, ledger), subject, ledger);
      const offset = subject.indexOf(pattern);
      assert.equal(result.matched, offset >= 0);
      if (offset >= 0) assert.deepEqual(result.captures, [{ start: offset, end: offset + pattern.length }]);
    }
  });
  await check('L12-negation-work', async () => {
    const ledger = new EreLedger(bounds, { work: 100 });
    await assert.rejects(compileEre('[^a]', ledger), error => error.resource === 'work');
    assert.equal(ledger.usage.work, 100);
  });
  await check('L13-composite-work', async () => {
    const ledger = new EreLedger(bounds);
    await compileEre('abc', ledger);
    assert.equal(ledger.usage.work, 12);
    const alternativeLedger = new EreLedger(bounds);
    await compileEre('a|b|c', alternativeLedger);
    assert.equal(alternativeLedger.usage.work, 14);
  });
  await check('P02-alternative-permutations', async () => {
    for (const pattern of ['(a|aa)(a?)', '(aa|a)(a?)']) for (const subject of ['aa', 'aaa']) {
      const ledger = new EreLedger(bounds);
      const result = await matchEre(await compileEre(pattern, ledger), subject, ledger);
      assert.deepEqual(result.values, [subject, 'aa', subject.length === 3 ? 'a' : '']);
    }
  });
  await check('P03-all-ascii-classes', async () => {
    const members = {
      alnum: code => code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122,
      alpha: code => code >= 65 && code <= 90 || code >= 97 && code <= 122,
      blank: code => code === 9 || code === 32, cntrl: code => code < 32 || code === 127,
      digit: code => code >= 48 && code <= 57, graph: code => code >= 33 && code <= 126,
      lower: code => code >= 97 && code <= 122, print: code => code >= 32 && code <= 126,
      punct: code => code >= 33 && code <= 126 && !(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122),
      space: code => [9,10,11,12,13,32].includes(code), upper: code => code >= 65 && code <= 90,
      xdigit: code => code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102,
    };
    for (const [name, expected] of Object.entries(members)) for (let code = 1; code < 128; code++) {
      const ledger = new EreLedger(bounds);
      const result = await matchEre(await compileEre(`^[[:${name}:]]$`, ledger), String.fromCharCode(code), ledger);
      assert.equal(result.matched, expected(code), `${name}:${code}`);
    }
  });
}
console.log(JSON.stringify({ event: 'results', selection, rows, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length }));
if (rows.length === 0 || rows.some(row => !row.pass)) process.exitCode = 1;
