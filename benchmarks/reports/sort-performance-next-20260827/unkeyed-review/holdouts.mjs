import assert from 'node:assert/strict';

export const baselineCommit = 'dce6e3824d6de6d03490a531cf2bc7d2d279bb8c';
export const acceptanceCommit = '68f037111981356823ad5fa1a58943e5231ccfd4';
export const acceptanceHash = '3d99fdebe7262d3fcce473e96af7ddbe6bb27b1fe17886657cddc8d32e8c0504';
const base64 = bytes => Buffer.from(bytes).toString('base64');
const lines = records => records.join('\n') + '\n';
const specimen = (id, script, stdin, stdout, extra = {}) => ({ id, script, stdin: base64(stdin), files: {}, expected: { stdout: base64(stdout), stderr: '', status: 0, files: {} }, ...extra });
const permuted = (id, flags, records, order) => specimen(id, `sort ${flags}`, lines(records), lines(order.map(index => records[index])));

export function holdouts() {
  const rows = [];
  const integers = ['9007199254740993 b', '9007199254740992 a', '-9007199254740992 c', '-9007199254740993 d', '999999999999999999999999999999 e', '1000000000000000000000000000000 f'];
  rows.push(permuted('precision-integers', '-ns', integers, [3, 2, 1, 0, 4, 5]));
  const fraction = '0'.repeat(79);
  const fractions = [`0.${fraction}2 b`, `0.${fraction}1 a`, `-0.${fraction}1 c`, `-0.${fraction}2 d`, `0.${fraction}10000 e`];
  rows.push(permuted('precision-fractions', '-ns', fractions, [3, 2, 1, 4, 0]));
  const prefixes = ['+9 plus', '1e9 exponent', '-.25 negative', '  \t-000.000 zero', '.5 half', '1.0one', '--2 invalid', 'Infinity invalid', '. invalid', '\v-2 invalid', '\t2 tabs'];
  rows.push(permuted('prefix-grammar', '-ns', prefixes, [2, 0, 3, 6, 7, 8, 9, 4, 1, 5, 10]));
  const ties = ['01 b', '1 a', '1.0 c', '001 d'];
  for (const [id, flags, order] of [
    ['ties-stable', '-ns', [0, 1, 2, 3]], ['ties-byte-fallback', '-n', [3, 0, 1, 2]],
    ['ties-reverse-fallback', '-nr', [2, 1, 0, 3]], ['ties-reverse-stable', '-nrs', [0, 1, 2, 3]],
    ['ties-unique-first', '-nu', [0]], ['ties-reverse-unique-first', '-nru', [0]],
  ]) rows.push(permuted(id, flags, ties, order));
  rows.push(permuted('signed-zero-unique', '-nu', ['-000.000 first', '0 second', '+1 third', 'nonnumeric last'], [0]));
  rows.push(permuted('guard-explicit-numeric-key', '-ns -k2,2n', ['9 1 z', '1 9 a', '4 2 b'], [0, 2, 1]));
  rows.push(permuted('guard-multiple-keys', '-n -t: -k2,2n -k1,1r', ['a:2', 'c:2', 'b:1'], [2, 1, 0]));
  rows.push(permuted('guard-key-local-replaces-global', '-nr -t: -k2,2', ['x:2', 'y:10'], [0, 1]));
  rows.push(permuted('guard-key-character-offsets', '-s -t: -k2.2,2.3n', ['a:x20z', 'b:x03z', 'c:x10z'], [1, 2, 0]));
  rows.push(permuted('guard-blanks', '-nbs', [' \t2 b', ' 1 a', '-1 c'], [2, 1, 0]));
  rows.push(permuted('guard-fold', '-nf', ['1 z', '1 A', '2 b'], [1, 0, 2]));
  rows.push(permuted('guard-plain', '', ['9', '10', '2'], [1, 2, 0]));
  rows.push(specimen('guard-check-success', 'sort -cns', '1 z\n01 a\n2 b\n', ''));
  rows.push(specimen('guard-check-disorder', 'sort -cn', '2\n1\n', '', { expected: { stdout: '', stderr: base64('sort: disorder at record 2\n'), status: 1, files: {} } }));
  rows.push(specimen('guard-check-unique', 'sort -cnu', '1\n01\n', '', { expected: { stdout: '', stderr: base64('sort: disorder at record 2\n'), status: 1, files: {} } }));
  rows.push(specimen('empty-input', 'sort -n', '', ''));
  rows.push(specimen('empty-records', 'sort -ns', '\n\n\n', '\n\n\n'));
  rows.push(specimen('empty-records-unique', 'sort -nu', '\n\n\n', '\n'));
  rows.push(specimen('natural-eof', 'sort -n', '2\n1', '1\n2\n'));
  rows.push(specimen('binary-numeric-fallback', 'sort -n', Buffer.from([49, 255, 10, 49, 0, 10, 49, 128]), Buffer.from([49, 0, 10, 49, 128, 10, 49, 255, 10])));
  rows.push(specimen('nul-numeric-fallback', 'sort -nz', Buffer.from([49, 255, 0, 49, 10, 0, 49, 128]), Buffer.from([49, 10, 0, 49, 128, 0, 49, 255, 0])));
  for (const delimiter of [10, 0]) for (const width of [2, 7]) {
    const input = Buffer.from(`20 z${String.fromCharCode(delimiter)}-1 a${String.fromCharCode(delimiter)}3 y`);
    const stdout = Buffer.from(`-1 a${String.fromCharCode(delimiter)}3 y${String.fromCharCode(delimiter)}20 z${String.fromCharCode(delimiter)}`);
    rows.push(specimen(`owned-offset-${delimiter}-${width}`, `sort -ns${delimiter === 0 ? 'z' : ''} input`, '', stdout, { borrowedWidth: width, files: { input: base64(input) }, expected: { stdout: base64(stdout), stderr: '', status: 0, files: { input: base64(input) } } }));
  }
  rows.push(specimen('missing-later-keeps-inplace', 'sort -n -o input input missing', '', '', { files: { input: base64('2\n1\n') }, expected: { stdout: '', stderr: base64("sort: ENOENT: no such file or directory, readStream '/work/missing'\n"), status: 2, files: { input: base64('2\n1\n') } } }));
  rows.push(specimen('source-error-keeps-output', 'sort -n -o kept input', '', '', { streamEffect: 'error', files: { input: base64('2\n1\n'), kept: base64('original') }, expected: { stdout: '', stderr: base64('sort: review injected EIO\n'), status: 2, files: { input: base64('2\n1\n'), kept: base64('original') } } }));
  rows.push(specimen('cancel-between-chunks-keeps-output', 'sort -n -o kept input', '', '', { streamEffect: 'abort', rejectsReason: true, files: { input: base64('2\n1\n'), kept: base64('original') }, expected: { files: { input: base64('2\n1\n'), kept: base64('original') } } }));
  return rows;
}

export const capRecipeNames = [
  'entry-below', 'entry-at', 'entry-above', 'empty-entry-below', 'empty-entry-at', 'empty-entry-above',
  'characters-below', 'characters-at', 'characters-above', 'huge-short-prefix', 'mixed-saturation',
];

export function capHoldouts({ entryCap, characterCap }) {
  assert.ok(Number.isSafeInteger(entryCap) && entryCap >= 4 && entryCap <= 100000);
  assert.ok(Number.isSafeInteger(characterCap) && characterCap >= 64 && characterCap <= 1048576);
  const rows = [];
  for (const [label, delta] of [['below', -1], ['at', 0], ['above', 1]]) {
    const count = entryCap + delta;
    const records = Array.from({ length: count }, (_, index) => `${count - index} label`);
    rows.push(specimen(`entry-${label}`, 'sort -ns', lines(records), lines([...records].reverse()), { capExpectation: { kind: 'entry', count } }));
    rows.push(specimen(`empty-entry-${label}`, 'sort -ns', '\n'.repeat(count), '\n'.repeat(count), { capExpectation: { kind: 'empty', count } }));
    const logicalCharacters = characterCap + delta;
    const recordsBySize = ['1'.repeat(Math.floor(logicalCharacters / 2)), '2'.repeat(Math.ceil(logicalCharacters / 2))];
    rows.push(specimen(`characters-${label}`, 'sort -ns', lines([...recordsBySize].reverse()), lines(recordsBySize), { capExpectation: { kind: 'characters', logicalCharacters } }));
  }
  const huge = `1${'x'.repeat(Math.min(2 * characterCap + 257, 2097409))}`;
  rows.push(specimen('huge-short-prefix', 'sort -ns', `2\n${huge}\n0\n`, `0\n${huge}\n2\n`, { capExpectation: { kind: 'backing', sourceCharacters: huge.length, normalizedCharacters: 3 } }));
  const mixed = Array.from({ length: entryCap + 3 }, (_, index) => index % 2 ? '1.000 tie' : '0001 tie');
  rows.push(specimen('mixed-saturation', 'sort -ns', lines(mixed), lines(mixed), { capExpectation: { kind: 'saturation', count: mixed.length } }));
  return rows;
}
