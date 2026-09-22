import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePdftotextArguments } from './admission.js';

const signal = new AbortController().signal;
test('exact parsing continues after operands and stops at the delimiter', () => {
  const result = parsePdftotextArguments(['input.pdf', '-f', '+2', '-enc', 'ASCII7', '-enc', 'UTF-8', '-', '--', '-raw'], signal);
  assert.deepEqual(result.files, ['input.pdf', '-', '-raw']);
  assert.equal(result.numbers.firstPage, 2);
  assert.equal(result.encoding, 'UTF-8');
  assert.equal(result.flags.raw, false);
});

test('public parser rejects unknown options but admits deliberate literal paths and option operands', () => {
  for (const option of ['-r=144', '-r144', '-lay', '-qr', '--unknown']) {
    assert.throws(() => parsePdftotextArguments(['input.pdf', option, '-h'], signal),
      { message: 'Unknown option: ' + option });
    assert.deepEqual(parsePdftotextArguments(['--', option], signal).files, [option]);
  }
  assert.deepEqual(parsePdftotextArguments(['./-qr', '/-qr', '-'], signal).files, ['./-qr', '/-qr', '-']);
  const result = parsePdftotextArguments(['-upw', '-unknown', '-enc', '--', '-h'], signal);
  assert.equal(new TextDecoder().decode(result.userPassword), '-unknown');
  assert.equal(result.encoding, '--');
  assert.equal(result.flags.help, true);
});

test('checked decimal grammar rejects degenerate numerics and never enables zero DPI', () => {
  for (const value of ['', '+', '-', '.', '+.', '1e2', ' 72', '72 ', 'NaN', 'Infinity', '0x48', '72junk']) {
    assert.throws(() => parsePdftotextArguments(['-r', value], signal));
  }
  for (const value of ['0', '-72', '0.0']) assert.throws(() => parsePdftotextArguments(['-r', value], signal));
  assert.equal(parsePdftotextArguments(['-r', '+144.5'], signal).numbers.resolution, 144.5);
  for (const value of ['2.0', '9007199254740992']) assert.throws(() => parsePdftotextArguments(['-f', value], signal));
  assert.throws(() => parsePdftotextArguments(['-f'], signal));
});

test('bbox wins over TSV in either order; raw wins over fixed and layout', () => {
  for (const args of [['-bbox', '-tsv'], ['-tsv', '-bbox'], ['-bbox-layout', '-tsv']]) {
    const result = parsePdftotextArguments(args, signal);
    assert.equal(result.format, 'bbox');
    assert.equal(result.flags.htmlMeta, true);
  }
  assert.equal(parsePdftotextArguments(['-tsv', '-htmlmeta'], signal).format, 'html-tsv');
  assert.equal(parsePdftotextArguments(['-layout', '-fixed', '6', '-raw'], signal).order, 'raw');
  assert.equal(parsePdftotextArguments(['-fixed', '-6'], signal).order, 'physical');
});

test('early validation survives help and quiet; invalid EOL continues with a direct diagnostic', () => {
  for (const suffix of ['-h', '-v', '-q']) {
    assert.throws(() => parsePdftotextArguments(['-colspacing', '0', suffix], signal));
    assert.throws(() => parsePdftotextArguments(['-urls', '-bbox', suffix], signal));
  }
  assert.equal(parsePdftotextArguments(['-colspacing', '10'], signal).numbers.colSpacing, 10);
  assert.throws(() => parsePdftotextArguments(['-colspacing', '10.01'], signal));
  const result = parsePdftotextArguments(['-q', '-eol', 'invalid'], signal);
  assert.equal(result.eol, 'unix');
  assert.deepEqual(result.diagnostics, ["Bad '-eol' value on command line\n"]);
});

test('all researched aliases are recognized without accepting GNU variants', () => {
  for (const alias of ['-h', '-help', '--help', '-?']) assert.equal(parsePdftotextArguments([alias], signal).flags.help, true);
  const result = parsePdftotextArguments(['-x', '1', '-y', '2', '-W', '3', '-H', '4', '-nodiag', '-cropbox', '-nopgbrk', '-listenc', '-v', '-remove-hyphens', 'soft'], signal);
  assert.deepEqual(result.files, []);
  assert.equal(result.numbers.width, 3);
  assert.equal(result.flags.noDiagonal, true);
  assert.equal(result.removeHyphens, 'soft');
});

test('CLI byte truncation is separate from future SDK raw passwords', () => {
  const result = parsePdftotextArguments(['-upw', 'a'.repeat(31) + 'é', '-opw', 'x'.repeat(40), '-enc', 'A'.repeat(200)], signal);
  assert.equal(result.userPassword.length, 32);
  assert.equal(result.userPassword[31], 0xc3);
  assert.equal(result.ownerPassword.length, 32);
  assert.equal(result.encoding.length, 127);
});

test('cancellation, byte/work/retention limits and malformed text fail before parsing', () => {
  const controller = new AbortController();
  controller.abort('stop');
  assert.throws(() => parsePdftotextArguments(['input.pdf'], controller.signal), error => error === 'stop');
  assert.throws(() => parsePdftotextArguments(['é'], signal, { inputBytes: 2 }));
  assert.equal(parsePdftotextArguments(['é'], signal, { inputBytes: 3 }).accounting.inputBytes, 3);
  assert.throws(() => parsePdftotextArguments(['abc'], signal, { work: 1 }));
  assert.throws(() => parsePdftotextArguments(['abc'], signal, { retainedBytes: 1 }));
  assert.throws(() => parsePdftotextArguments(['a\0b'], signal));
  assert.throws(() => parsePdftotextArguments(['\ud800'], signal));
  assert.throws(() => parsePdftotextArguments([], signal, { work: NaN }));
  assert.throws(() => parsePdftotextArguments([], signal, { work: 0 }));
  const result = parsePdftotextArguments(['😀'], signal);
  assert.equal(result.accounting.inputBytes, 5);
  assert.equal(result.accounting.decodedBytes, 4);
  assert.equal(result.accounting.outputBytes, 0);
});

test('a replaced argv iterator cannot bypass admission of indexed option operands', () => {
  const args = ['-upw', 'x'.repeat(5000)];
  Object.defineProperty(args, Symbol.iterator, { value: function* () {} });
  assert.throws(() => parsePdftotextArguments(args, signal, { inputBytes: 100 }));
});

test('cancellation raised during indexed argument acquisition is observed before parsing', () => {
  const controller = new AbortController(), reason = new Error('cancel during admission');
  const args = ['input.pdf', '-h'];
  Object.defineProperty(args, 0, { get() { controller.abort(reason); return 'input.pdf'; } });
  assert.throws(() => parsePdftotextArguments(args, controller.signal), error => error === reason);
});
