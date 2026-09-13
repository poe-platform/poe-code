# LANG-BIGINT-PATTERN-KEY — local repair

Parent main: `1330eda497a2ec708fdc150b121b87194f77b115`, with unrelated
working changes preserved. Node 22.23.2 / ICU 78.2, Darwin arm64.
Target remains ECMA-262 edition 16 / ECMA-402 edition 12 plus existing extension
pins. Test262 remains `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

The complete V4 manifest, aggregate and mismatch inventory were independently
rehashed against the prior verification receipt; all match. The captured source
file and staged-change fingerprints are in `bigint-before.json`. Only
`src/interp/patterns.ts` changed among those pre-existing source files; the
unrelated staged SHA-256 remains
`839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`.

[ECMA-262 2025 PropertyName evaluation](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-object-initializer-runtime-semantics-evaluation)
converts a numeric literal's value to a string. Independent counterexample:
`var {1n:value}={'1':7}; value` must yield 7; before the repair it throws
`Unsupported static property node 'BigIntLiteral'.` Computed `[1n]` and string
keys already pass. The regression first records **five failed / two passed**
(`bigint-red.log`). Decimal values beyond safe Number precision, binary/octal/hex
keys, assignment, defaults and rest exclusions are covered. The narrow fix uses
the same BigInt-to-string conversion already used for object literal keys.

Commands and terminal results:

- `npx vitest run packages/safe-js/test/conformance/bigint-pattern-key.test.ts`
  reproduces the five failures before repair.
- `npx vitest run packages/safe-js/test/conformance/bigint-pattern-key.test.ts packages/safe-js/src/interp/patterns.test.ts packages/safe-js/src/interp/computed-property-keys.test.ts packages/safe-js/test/conformance/eval-deleted-var.test.ts packages/safe-js/test/conformance/eval-deleted-global-function.test.ts`
  passes **76 tests / five files, zero skips** (`bigint-final-focused.log`).
- Targeted `npx eslint` for the changed source and regression exits 0.
- `npm run build:workspaces -- --workspace=@poe-code/safe-js` exits 0,
  including eight native built-import checks (`bigint-build.log`).
- The literal original-context command in `bigint-stable-command.json` passes
  **two files / three variants**, no failures, unsupported modes or accounting
  errors. Both original BigInt strict/sloppy failures and the exact recorded
  neighboring control pass. Unchanged fixture hashes are in the terminal report
  `bigint-stable-upstream.jsonl`; candidate source-content SHA-256 is
  `b816e62f16eb1619c39062c88407ae421a271c534285b874ee418887e1a0ca6a`.
  The 3000 ms variant / 10000 ms startup limits and budgets are unchanged.

Two earlier upstream attempts are explicitly **aborted**, not passes: one saw
this task's test-file edit and one overlapped the maintained build (the runner
also fingerprints dist). Their logs/reports remain visible. An initial added
integration test used the wrong lint return shape and failed; it was corrected
to the actual Diagnostic[] API before the terminal focused run.

The regression additionally verifies lint acceptance, three suspension/dump/
restore cycles, completed replay, a closure retaining its dynamic Function
source and absent ambient process/require authority. This is bounded source and
isolation coverage, not complete origin-diagnostic or security qualification.
Built SDK and CLI execute `bigint-smoke.ajs` and agree on `[7,"other"]`.
`npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/bigint-smoke.ajs`
produces the visually inspected readable `bigint-cli.png`.

The earlier `unresolved-minimal-controls.json` overstates three reductions:
Annex B arguments and ordinary/async generator creation examples agree with
their own native controls, not their recorded expected values. Those reductions
do not validate defects; their original upstream failures remain unresolved
until their exact contexts and normative clauses are independently checked.

This repair discharges two earlier primary-owner nonpasses, leaving **191**
prior primary-owner nonpasses before target/extension disposition. The prior
126 resource nonpasses, other-owner reconciliation, full runtime/artifact gates
and source-diagnostic gaps remain open. No broader rerun or synthetic aggregate
is claimed. Local commit, remote-main delivery and publication are separate;
no push was requested and no task publication receipt exists.
