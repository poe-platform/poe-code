# LANG-OPTIONAL-CHAIN-TEMPLATE — local early-error repair

Parent main `25dc53f1f` (the separate BigInt-pattern repair), preserved working
changes, Node 22.23.2 / ICU 78.2, Darwin arm64. Target unchanged: ECMA-262 edition
16 / ECMA-402 edition 12 and separately pinned extensions. The original fixture
revision remains `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

[ECMA-262 2025 §13.3.1.1](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-static-semantics-early-errors)
requires an early SyntaxError for tagged templates continuing OptionalChain.
Independent reduction: `var a=null;a?.b` followed immediately by a template
literal. The previous parser accepted it, and eval could execute earlier side
effects before a runtime TypeError. Parenthesizing the chain before tagging is
valid and must remain accepted.

`npx vitest run packages/safe-js/src/parse/optional-chain-template-early-error.test.ts`
first records **six failures / three passing controls** (`optional-red.log`).
The repair checks the parser's existing `continuesOptionalChain` state before
parsing a tag. It adds no new state, host authority, or runtime evaluation path.
Ordinary tags and parenthesized optional-chain tags retain their behavior.

The initial integration expectation assumed lint returned diagnostics for this
syntax. Its existing public parser path throws a parse error instead; the final
assertion verifies this rejection API without suppressing any failure. The
intermediate log `optional-green.log` records that mismatch. The final parser
throws SyntaxError with the existing location convention, producing a public
ParseError. The standalone Script oracle and public eval checks verify the
standard early-error phase separately.

Terminal commands and results:

- `npx vitest run packages/safe-js/src/parse/optional-chain-template-early-error.test.ts packages/safe-js/src/parse/new-tagged-template.test.ts packages/safe-js/src/interp/optional-chain-short-circuit.test.ts packages/safe-js/src/interp/optional-chain-async.test.ts packages/safe-js/src/interp/tagged-template-error-order.test.ts`
  passes **73 tests / five files, zero skips** (`optional-replay-focused.log`).
  Coverage includes strict/sloppy Script, computed/member/call chain tails,
  parenthesized/ordinary controls, eval before side effects, three successive
  pending checkpoints and completed replay.
- Targeted `npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/optional-chain-template-early-error.test.ts`
  exits 0 (`optional-lint.log`).
- `npm run build:workspaces -- --workspace=@poe-code/safe-js` exits 0, including
  eight native built-import checks (`optional-build.log`).
- The literal maintained command in `optional-command.json` reuses the eight
  original failure rows and their four recorded neighboring controls. The
  original-context result is **six files / 12 variants / 12 passed**, no failures,
  unsupported modes or metadata/execution errors, exit 0. Original fixture hashes
  and modes are in `optional-upstream.jsonl`; source-content SHA-256 is
  `566450c0e5ebfdf4395137a635689b13616e79b8a3a1c199c4976c2eee710c42`.
  Variant timeout 3000 ms, startup allowance 10000 ms and budgets are unchanged.

Built CLI (`node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/optional-smoke.ajs`)
exits 2 with the same public ParseError message as the built SDK. The screenshot
command `npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/optional-smoke.ajs`
was executed and `optional-cli.png` visually inspected. **An unresolved display
interaction remains:** the trailing-newline excerpt puts the caret after the
following blank line. The filename/line/column and rejection are displayed, but
this does not qualify complete visual diagnostic correctness. No unrelated
formatter code was changed as part of this early-error repair.

Eight prior primary-owner failures are repaired here, leaving **183** prior
primary-owner nonpasses after the separate two-case BigInt repair, before
edition/extension disposition. This subtraction is not a whole-selection rerun.
Previously recorded proposal/extension failures and 126 resource failures stay
visible nonpasses. Full category ownership reconciliation, supported-runtime and
installed-artifact qualification, source origins and publication remain open.

Only the four-line parser insertion, this regression and this evidence are the
atomic repair. Other parser changes remain user-owned and uncommitted. No push
was requested; remote-main delivery and successful task publication are not
claimed. Historical release receipts do not publish this fix.
