const hex = text => Buffer.from(text).toString('hex');
const fixture = (id, category, argv, input, extra = {}) => ({ id, category, argv, inputHex: hex(input), ...extra });
const recovery = 'if . == 0 then (7 / .) elif . == 1 then empty else . end';
const malformed = Buffer.from('41c18042eda0bf43f490808044e28245f09f98460a47e2', 'hex');

export const cases = [
  fixture('review-generator-prefix-next-record', 'generator-error-order', ['-c', '(.[] | 8 / .), "tail"'], '[2,0,4]\n[4]\n'),
  fixture('review-exit-last-false', 'exit-status', ['-ce', recovery], '0\nfalse\n'),
  fixture('review-exit-last-empty', 'exit-status', ['-ce', recovery], '0\n1\n'),
  fixture('review-exit-last-truthy', 'exit-status', ['-ce', recovery], '0\n2\n'),
  fixture('review-raw-json-iteration-recovery', 'raw-runtime-recovery', ['-Rce', 'fromjson | .[]'], '[1,false]\nnull\n[null,2]\n'),
  fixture('review-join-generator-partial', 'generator-error-order', ['-c', 'join(("~", false, ":"))'], '["A",null,8.00]\n["B","C"]\n'),
  fixture('review-fromjson-two-error-records', 'diagnostic-order', ['-c', 'fromjson'], '"[4]"\n"["\n"{\\\"a\\\":}"\n"false"\n'),
  fixture('review-entries-duplicate-integer-keys', 'object-order-number-copy', ['-c', 'from_entries | [., keys_unsorted, to_entries]'], '[{"key":"9","value":9007199254740995},{"key":"01","value":-0.000},{"key":"3","value":7.5000},{"key":"9","value":9007199254740997}]'),
  fixture('review-nested-lexeme-copy', 'numeric-lexemes', ['-c', '[., tojson, (tojson | fromjson)]'], '{"9":[9007199254740995,1.2300e-004,-0.0000],"3":{"01":1E+10000,"x":1e-9999}}'),
  fixture('review-sort-unique-zero-exponents', 'numeric-order', ['-c', '[sort, unique, map(tostring)]'], '[9007199254740995,9007199254740994,-0.0000,0.000,1e-9999,-1e-9999,1E+10000,9E+9999]'),
  fixture('review-object-quantifier-short-circuit', 'object-generator-order', ['-c', '[any(.[]; . == 2 or (7 / 0)), all(.[]; . != 2 and (7 / 0))]'], '{"9":2,"3":0}\n{"3":0,"9":2}\n{"x":2}'),
  {
    id: 'review-pipe-number-object-roundtrip', category: 'pipeline-order',
    inputHex: hex('9007199254740995\n-0.0000\n1.2300e-004'),
    stages: [['-c', '{"9":.,"3":tojson}'], ['-sc', 'map(to_entries | from_entries)'], ['-c', '.[] | [."9", ."3"]']],
  },
  fixture('review-file-error-line-continuation', 'file-diagnostics', ['-ce', '.[] | 12 / .', 'alpha.txt', 'beta.txt'], '', {
    files: { 'alpha.txt': hex('[3,0,2]\n\n[4]\n'), 'beta.txt': hex('\n[0]\n[6]\n') },
  }),
  fixture('review-raw-malformed-boundaries', 'malformed-utf8', ['-Rc', '.'], malformed, { allBoundaries: true }),
  fixture('review-raw-slurp-malformed-boundaries', 'malformed-utf8-slurp', ['-Rsc', '.'], Buffer.concat([Buffer.from('efbbbf', 'hex'), malformed, Buffer.from('\r\n')]), { allBoundaries: true }),
  fixture('review-json-malformed-boundaries', 'malformed-utf8-json', ['-c', '.'], Buffer.concat([Buffer.from('"'), malformed.subarray(0, -3), Buffer.from('"\n"ok"')]), { allBoundaries: true }),
  fixture('review-low-surrogates-surrounded', 'surrogate-decoding', ['-c', '.'], '"a\\udfff\\udc00b\\ud83d\\ude42c"\n"ok"', { allBoundaries: true }),
  fixture('review-high-surrogate-after-output', 'surrogate-error-prefix', ['-c', '.'], '"ok"\n"a\\udbff\\u0061"\n"tail"', { allBoundaries: true }),
  fixture('review-raw-three-file-byte-boundary', 'file-utf8-reset', ['-Rsc', '.', 'alpha.txt', 'beta.txt', 'gamma.txt'], '', {
    files: { 'alpha.txt': '58e2', 'beta.txt': '82', 'gamma.txt': 'ac590a' },
  }),
  fixture('review-number-error-keeps-lexeme-and-next-input', 'numeric-error-recovery', ['-ce', 'sort'], '9007199254740995\n[7.5000,-0.0000,1e-9999]\n'),
];
