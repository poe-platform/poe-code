import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

const config = { kind: "grep", fixed: false, extended: true, perl: true, caseMode: "sensitive", whole: false, word: false, nullData: false } as const;

for (const pattern of ['(?<=a+)b', '(?<=a|bc)d']) {
  test(`rejects unsupported variable-length lookbehind ${pattern}`, () => {
    assert.throws(() => prepareErgonomicRegex([pattern], config), /PCRE variable-length lookbehind/u);
  });
}

test('lookaround stays unsupported outside Perl mode', () => {
  assert.throws(() => prepareErgonomicRegex(['a(?=b)'], { ...config, perl: false }), /unsupported ERE lookaround/u);
});

test('positive lookaround retains captures and does not consume assertion text', () => {
  const prepared = prepareErgonomicRegex(['(?<=(a))b(?=(c))'], { ...config, captures: true });
  if (prepared.mode !== 'vm') assert.fail('expected VM');
  assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode('abc'), true), [{
    start: 1, end: 2, captures: new Map([[1, { start: 0, end: 1 }], [2, { start: 2, end: 3 }]]),
  }]);
});

test('lookbehind counts Unicode scalars and returns byte offsets', () => {
  const prepared = prepareErgonomicRegex(['(?<=é)b'], config);
  if (prepared.mode !== 'vm') assert.fail('expected VM');
  assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode('éb'), true), [{ start: 2, end: 3 }]);
});
