import assert from "node:assert/strict";
import test from "node:test";
import { prepareErgonomicRegex } from "./ergonomic-regex.js";

const config = { kind: "grep", extended: false, fixed: false, caseMode: "sensitive", whole: false, word: false, nullData: false } as const;

for (const [pattern, translated, input, match] of [
  ['a$b', 'a\\$b', 'a$b', 'a$b'],
  ['a^b', 'a\\^b', 'a^b', 'a^b'],
  ['^*a', '^\\*a', '*a', '*a'],
  ['^*a', '^\\*a', 'x*a', undefined],
  ['^**a$', '^\\**a$', '**a', '**a'],
  ['^^a', '^\\^a', '^a', '^a'],
  ['a$$', 'a\\$$', 'a$', 'a$'],
  ['a$*b', 'a\\$*b', 'a$$b', 'a$$b'],
  ['a^*b', 'a\\^*b', 'a^^b', 'a^^b'],
  ['\\(^*a$\\)\\|^b$', '(^\\*a$)|^b$', '*a', '*a'],
  ['\\(^*a$\\)\\|^b$', '(^\\*a$)|^b$', 'b', 'b'],
  ['a$\\|b^c', 'a$|b\\^c', 'b^c', 'b^c'],
  ['\\(^a$\\)', '(^a$)', 'a', 'a'],
  ['\\(^a$\\)', '(^a$)', 'xa', undefined],
  ['\\(^a$\\)', '(^a$)', 'ax', undefined],
  ['a\\(^b\\)', 'a(^b)', 'ab', undefined],
  ['\\(a$\\)b', '(a$)b', 'ab', undefined],
  ['a$\\\\|b', 'a\\$\\\\\\|b', 'a$\\|b', 'a$\\|b'],
  ['\\^a\\$', '\\^a\\$', '^a$', '^a$'],
  ['[$^]*', '[$^]*', '$^', '$^'],
] as const) test(`BRE anchor translation and VM matching: ${pattern} on ${input}`, () => {
  assert.deepEqual(prepareErgonomicRegex([pattern], config), { mode: "delegated", patterns: [translated], extended: true });
  const prepared = prepareErgonomicRegex([pattern], { ...config, forceVm: true });
  if (prepared.mode !== "vm") assert.fail("expected VM matcher");
  const found = prepared.vm.matchBytes(new TextEncoder().encode(input), false)[0];
  assert.equal(found ? input.slice(found.start, found.end) : undefined, match);
});

for (const kind of ['grep', 'rg'] as const) test(`${kind} keeps extended anchors in every position`, () => {
  for (const pattern of ['a$b', 'a^b']) {
    const extended = { ...config, kind, extended: true };
    assert.deepEqual(prepareErgonomicRegex([pattern], extended), { mode: 'delegated', patterns: [pattern], extended: true });
    const prepared = prepareErgonomicRegex([pattern], { ...extended, forceVm: true });
    if (prepared.mode !== 'vm') assert.fail('expected VM matcher');
    assert.deepEqual(prepared.vm.matchBytes(new TextEncoder().encode(pattern), false), []);
  }
});
