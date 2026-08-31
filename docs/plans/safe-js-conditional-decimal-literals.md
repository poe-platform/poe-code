# Conditional decimal literal disambiguation

## Scope

Numeric separators already work in decimal integers, fractions, exponents, and
binary, octal, and hexadecimal literals. Keep that behavior unchanged.

Fix the missing decimal-digit lookahead for optional chaining: `enabled?.5:0`
must parse identically to `enabled ? .5 : 0`. ECMA-262 §12.8 defines
`OptionalChainingPunctuator` as `?.` only when the next character is not a
`DecimalDigit`; §12.9.3 supplies the decimal literal and separator grammar.

Exact owned files:

- `packages/safe-js/src/parse/tokenizer.ts`
- `packages/safe-js/src/parse/numeric-literals.test.ts`
- `docs/plans/safe-js-conditional-decimal-literals.md`

No builtin, interpreter, README, dependency, or execution-boundary changes.
No native evaluation, host access, build, installation, commit, or push.

## Implementation and validation

1. Add fast in-memory tests for existing separator coverage and the failing
   conditional-fraction ambiguity, including token positions and interpolation.
2. Apply the decimal-digit lookahead in shared punctuator matching, covering
   ordinary source and template interpolation without parser changes.
3. Preserve optional member, computed-member, and call access; reject malformed
   fractions, separator placement, and incomplete conditional expressions.
4. Run the focused tests red then green, followed by existing tokenizer and
   parser tests. No generated artifacts or visual CLI changes are involved.

## Coordination

Lovelace01a055e9-aa42-7952-91df-fdabddc576ab: only the three files above are owned.
Mendel01a055ed-8555-7192-8752-8efa501a3df3: documentation examples are
`enabled?.5:0` and `enabled?.1_25e+2:0`, equivalent to their spaced ternary forms.
Direct agent messaging is unavailable; handoff is recorded for root relay.

## Publication validation

- Root relayed the author's 181 passing tests and Fermat's independent approval:
  1,044 tests in 18 files passed on each of Node 22.22.2 and Node 18.20.8.
- Publisher ran the combined normal build successfully: 68 workspace tasks,
  schema generation, TypeScript, and bundle. All 24 normal smoke checks passed.
- Built CLI examples returned `0.5`, `0`, and `12.5` identically on Node 22.22.2
  and Node 18.18.2. Actual output was captured in
  `out/language-feature-cli/examples.png` and visually checked; artifacts remain
  outside the commit.
- Root approved publication together with String#isWellFormed and reviewed README
  updates, using normal commit/push hooks.
