export const baselineCommit = '08a26051438f5c6bdde100a4fe724dbb84f6fca4';
export const acceptedIndependentCommit = '3fe952ea89034ceea784be26731581aabbb898c8';
const b64 = value => Buffer.from(value).toString('base64');
const lines = records => records.join('\n') + '\n';
const row = (id, script, input, output, extra = {}) => ({ id, script, input: b64(input), expected: { status: 0, stdout: b64(output), stderr: '', files: {} }, ...extra });
const permutation = (id, flags, records, order) => row(id, `sort ${flags}`, lines(records), lines(order.map(index => records[index])));

export function holdouts() {
  const rows = [
    permutation('inherited-numeric', '-ns -t: -k2,2', ['b:10', 'a:2', 'c:-1'], [2, 1, 0]),
    permutation('local-replaces-global-numeric', '-nr -t: -k2,2r', ['b:10', 'a:2', 'c:1'], [1, 0, 2]),
    permutation('local-numeric-replaces-global-reverse', '-rs -t: -k2,2n', ['b:10', 'a:2', 'c:-1'], [2, 1, 0]),
    permutation('local-reverse-end-flags', '-s -t: -k2,2nr', ['b:10', 'a:2', 'c:-1'], [0, 1, 2]),
    permutation('whitespace-included-character', '-s -k2.2,2n', ['a 20', 'b\t3', 'c  10'], [1, 2, 0]),
    permutation('whitespace-blanks-transform', '-s -k2.2,2bn', ['a 20', 'b\t13', 'c  11'], [0, 2, 1]),
    permutation('delimited-empty-and-missing', '-s -t: -k2,2n', ['a:', 'b', 'c:2', 'd:-1', 'e::9'], [3, 0, 1, 4, 2]),
    permutation('open-ended-key', '-s -t: -k2n', ['a:20:0', 'b:3:90', 'c:-1:8'], [2, 1, 0]),
    permutation('end-field-and-char-boundary', '-s -t: -k2.2,2.3n', ['a:x209', 'b:x039', 'c:x109'], [1, 2, 0]),
    permutation('out-of-range-character', '-s -t: -k2.99,2.100n', ['b:2', 'a:1', 'c:3'], [0, 1, 2]),
    permutation('start-after-end', '-s -t: -k3,2n', ['z:2:8', 'a:1:9', 'b:3:0'], [0, 1, 2]),
    permutation('utf8-byte-offset', '-s -t: -k2.3,2n', ['a:é20', 'b:é3', 'c:é-1'], [2, 1, 0]),
    row('invalid-byte-key-and-fallback', 'sort -t: -k2,2n', Buffer.from([98,58,49,255,10,97,58,49,128,10,99,58,48,10]), Buffer.from([99,58,48,10,97,58,49,128,10,98,58,49,255,10])),
    permutation('exact-integers-above-double', '-s -t: -k2,2n', ['a:9007199254740993', 'b:9007199254740992', 'c:-9007199254740992', 'd:-9007199254740993'], [3, 2, 1, 0]),
    permutation('exact-fractions-and-prefix-grammar', '-s -t: -k2,2n', ['a:.00000000000000000002', 'b:.00000000000000000001', 'c:1e3', 'd:+9', 'e:-.1', 'f:word', 'g:0001.000tail'], [4, 3, 5, 1, 0, 2, 6]),
    permutation('ties-stable', '-s -t: -k2,2n', ['z:01', 'a:1.0', 'b:0001'], [0, 1, 2]),
    permutation('ties-reverse-byte-fallback', '-r -t: -k2,2n', ['b:01', 'z:1.0', 'a:0001'], [1, 0, 2]),
    permutation('unique-first-signed-zero', '-u -t: -k2,2n', ['z:-0', 'a:000.000', 'b:+9', 'd:2', 'e:02'], [0, 3]),
    permutation('reverse-unique-first', '-u -t: -k2,2nr', ['z:01', 'a:1', 'b:2', 'c:02', 'd:-1'], [2, 0, 4]),
    permutation('guard-multiple-keys', '-s -t: -k2,2n -k1,1r', ['a:2', 'c:2', 'b:1'], [2, 1, 0]),
    permutation('guard-nonnumeric-local', '-n -t: -k2,2f', ['b:z', 'a:A', 'c:b'], [1, 2, 0]),
    permutation('guard-numeric-fold-transform', '-s -t: -k2,2nf', ['z:10', 'a:2', 'b:1'], [2, 1, 0]),
    row('guard-check-disorder', 'sort -c -t: -k2,2n', 'a:2\nb:1\n', '', { expected: { status: 1, stdout: '', stderr: b64('sort: disorder at record 2\n'), files: {} } }),
    row('borrowed-offset-finalizer-newline', 'sort -s -t: -k2,2n', 'a:20\nb:-1\nc:3', 'b:-1\nc:3\na:20\n', { borrowedWidth: 3 }),
    row('borrowed-offset-finalizer-nul', 'sort -sz -t: -k2,2n', 'a:20\0b:-1\0c:3', 'b:-1\0c:3\0a:20\0', { borrowedWidth: 5 }),
    row('input-error-keeps-destination', 'sort -s -t: -k2,2n -o output input absent', '', '', { files: { input: b64('a:2\nb:1\n'), output: b64('keep') }, expected: { status: 2, stdout: '', stderr: b64("sort: ENOENT: /absent\n"), files: { input: b64('a:2\nb:1\n'), output: b64('keep') } } }),
    row('cancel-input-keeps-destination', 'sort -s -t: -k2,2n -o output', 'a:2\n', '', { cancel: true, files: { output: b64('keep') }, expected: { rejection: 'same-abort-reason', stdout: '', stderr: '', files: { output: b64('keep') } } }),
    row('output-budget-rejection', 'sort -s -t: -k2,2n', 'a:2\nb:1\n', '', { limits: { outputBytes: 3 }, expected: { rejection: 'outputBytes', files: {} } }),
  ];
  return rows;
}

export const capRecipes = [
  ...['below', 'at', 'above'].map((position, index) => ({ id: `entry-${position}`, kind: 'entry', delta: index - 1 })),
  ...['below', 'at', 'above'].map((position, index) => ({ id: `retained-${position}`, kind: 'retained', delta: index - 1 })),
  { id: 'oversized-extracted-small-prefix', kind: 'huge-key' },
  { id: 'oversized-record-small-key', kind: 'huge-record' },
  { id: 'fallback-mid-sort-stable-ties', kind: 'saturation' },
  { id: 'empty-keys-entry-cap', kind: 'empty' },
];

export const capIntent = {
  binding: 'Bind entry/retained limits and conservative whole-record charge only after exact candidate routing. Retain formula input and output manifests. No semantic changes.',
  entry: 'Use E-1/E/E+1 distinct owned records with numeric second fields, descending integer keys; output exact reversed records. Assert admissions <= E, no bypass and uncached fallback after saturation.',
  retained: 'Construct records whose conservative aggregate backing/string charge is the nearest representable below/at/above B. Record quantization explicitly if exact equality is impossible. Stable equal numeric keys preserve all bytes/order. Assert recorded retained charges <= B and admission rejects overflow.',
  hugeKey: 'Three records 2, 1 plus a bounded long nonnumeric suffix, 0 in field two. Expected numeric order 0/1/2, source bytes unchanged. Huge key must bypass retention even though normalized number is tiny.',
  hugeRecord: 'As hugeKey but put long suffix outside -k2,2n. Prove whole-record Map-key backing charge; extracted byte views must not evade accounting.',
  saturation: 'More than E equal exact numeric records with alternating representations and distinct labels, -s; preserve input order during mixed cache hits and uncached fallback. Compare comparison counts and output effects.',
  empty: 'E+1 records with missing second key; stable input order, finite entry admission despite empty parsed strings.',
  bounds: 'No native campaign or risky expressions. Per child 512 MiB heap, <= 12 MiB input, <= 16 MiB captured output, parent 180 second watchdog. No elapsed-time performance claims.',
};

export const mutationIntent = [
  ['wrong-key', 'Parse whole record or first field instead of selected field; inherited-numeric detects.'],
  ['modifier', 'Merge local/global flags or misapply direction; local replacement/reverse holdouts detect.'],
  ['precision', 'Replace exact decimal comparator with floating Number; exact integer/fraction holdouts detect.'],
  ['guard', 'Construct/admit keyed cache for multi-key/non-numeric/check/fold/blank transform modes; operation counters reject even if output agrees.'],
  ['entry-cap', 'Disable entry limit; above/empty admissions reject.'],
  ['retained-cap', 'Disable retained bound; retained-above/huge recipes reject.'],
  ['backing-charge', 'Charge normalized number or extracted key only; oversized whole record exposes undercharge.'],
  ['fallback', 'Return arbitrary numeric value on cap rejection; ordered caps detect incorrect bytes/order.'],
  ['owning-copy', 'Replace collected-record/pending copies with borrowed views; offset producer reuse/finalizer detects.'],
];
