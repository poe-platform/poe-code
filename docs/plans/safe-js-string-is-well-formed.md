# String.prototype.isWellFormed

## Scope

Add the missing zero-argument `isWellFormed()` method to SafeJS string values.
Return whether UTF-16 contains no unpaired surrogate code units. Empty strings,
ordinary BMP text, and valid high/low surrogate pairs return true. Extra arguments
are evaluated normally but are not consumed, coerced, or invoked by this method.

The existing Number formatting and String method implementations were inspected;
`isWellFormed` is absent from both implementation and current plans. This work does
not change Number, RegExp, parser/tokenizer, generic borrowed-method receiver
semantics, host capabilities, or `toWellFormed`.

## Owned paths

- `packages/safe-js/src/interp/methods/string.ts`
- `packages/safe-js/src/interp/methods/string-is-well-formed.test.ts`
- `docs/plans/safe-js-string-is-well-formed.md`

README.md and packages/safe-js/README.md belong to Mendel and are not edited here.

## Implementation and validation

1. Add fixed UTF-16 fixtures, public execution cases, method metadata, and ignored
   argument regressions. Run the new file before production changes to record RED.
2. Register the method and scan code units directly without relying on a newer
   host String intrinsic, allocating output strings, or adding dependencies.
3. Run the new and neighboring Number/String suites on Node 22 and Node 18.18.2.
   Compare fixtures with the native method when available, keeping fixed expected
   values on Node 18. Check formatting and whitespace only in owned files.

Primary semantics: ECMA-262, String.prototype.isWellFormed and
IsStringWellFormedUnicode, consulted from the current TC39 specification.
`https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.iswellformed`

Public examples: `"hello".isWellFormed()` is true;
`"\uD83D\uDE00".isWellFormed()` is true; `"\uD800".isWellFormed()` is false.

## Results

- RED: all 25 new tests failed before implementation because the method was absent.
- Initial implementation passed 24 tests; the metadata test exposed missing
  zero-arity metadata. Adding method-specific `length: 0` completed the behavior.
- GREEN: 64 tests across the new file, `string.test.ts`, `number.test.ts`, and
  `run.string-coercion.test.ts` passed on Node 22.22.2 (1.65 seconds) and Node
  18.18.2 (1.61 seconds). The new file contributes 25 passing tests on each runtime.
- Prettier checks passed for all three owned files; `git diff --check` passed.
- No dependencies, generated artifacts, README changes, commit, or push.

## Publication validation

- Root relayed Lorentz's independent approval: 1,444 tests in 16 files passed on
  each of Node 22.22.2 and Node 18.18.2.
- Publisher ran the normal build successfully: 68 workspace tasks, schema
  generation, TypeScript, and bundle. All 24 normal smoke checks passed.
- Built CLI examples passed identically on Node 22.22.2 and Node 18.18.2;
  `out/language-feature-cli/examples.png` captures the actual output and was
  visually checked. These ad hoc artifacts are not included in the commit.
- Root approved publication together with the conditional-decimal change and
  reviewed README updates, using normal commit/push hooks.
