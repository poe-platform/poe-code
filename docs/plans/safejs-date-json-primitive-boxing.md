# Generic Date JSON conversion boxes all primitives

## Evidence

Four native-comparison tests failed before modification (02298e): BigInt and
Symbol receivers reached `toISOString` as primitives instead of objects, and
their inherited `Symbol.toPrimitive` hooks were skipped entirely. An Infinity
result from those hooks should stop conversion with null before ISO lookup;
the old implementation instead read and called the ISO hook.

[Date.prototype.toJSON](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.prototype.tojson)
first applies ToObject, then number-hinted ToPrimitive, then returns null for
non-finite numbers or invokes `toISOString` on the same object. Its generic
behavior includes BigInt and Symbol, not only number, string and boolean.

## Change

Extend the existing primitive-boxing condition in `date.ts` to BigInt and
Symbol. Reuse the existing box allocation, guest coercion and method dispatch.
No new primitive conversion or host exposure mechanism is needed.

## Checks

- Baseline: four failures against independent native VM contexts.
- Initial fix: 45 tests in three files passed (4f2366).
- Expanded regression plus Date tests: 117 tests in three files passed
  (21dc19). Eight new cases cover boxing, shared receiver identity across
  conversion/getter/call, early return and abrupt completion.
- Runtime and regression lint passed (644968); TypeScript no-emit passed
  (ed3e8f).
- README updated. No visual CLI behavior is changed.

The 117-test selection included an unmatched boxed-primitives filename; it
does not establish boxed-value test coverage. The existing `boxed.test.ts`,
`boxed-boundaries.test.ts` and `date-coercion.test.ts` were checked separately:
all 80 tests passed (6c19d5). Whitespace validation also passed.

No full-package pass is claimed. Changes remain local under the release hold.
