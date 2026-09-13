# new.target terminal spelling — 2026-09-13

LANG-NEW-TARGET-SPELLING closes two original primary-owner failures, with whole-task
acceptance still open. Candidate parent SHA `a43f01b8b549e02ffd4cff78a637e6e41561600b`
plus preserved working changes; source fingerprint
`52adcef3e986f6ea0e77b1462117640313807f33a955c1c9935e93bc0c180a5f`.
Node 22.23.2 / ICU78.2, Darwin arm64. Target remains ECMA-262 edition16 /
ECMA-402 edition12 plus the ledger's explicit extensions, with unchanged Test262
pin `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

The complete V4 manifest/aggregate/inventory hash verification is retained in the
immediately preceding [integrity receipt](../class-modifiers/historical-integrity.json).
Its raw rows identify strict/sloppy failures for
`language/expressions/new.target/escaped-target.js`; recorded neighboring
`escaped-new.js` is reused. The [published grammar notation](https://tc39.es/ecma262/2025/multipage/notational-conventions.html#sec-grammar-notation)
requires the literal `target` terminal. Minimal counterexample:
`function f() { new.t\u0061rget; }` was accepted. Independent `new.#target`
was also incorrectly accepted; string-property and ordinary escaped constructor
names supply negative/positive controls without simply reproducing the implementation.

TDD: initial [red.log](red.log) has five parser failures and one incorrectly authored
lint probe (`typeof marker` triggers the existing unknown-name lint diagnostic).
The probe was corrected to inspect `globalThis.marker`, before the runtime repair.
[Corrected red](red-corrected-probe.log) has **6 failed / 6 passed**, including
observable side effects executing before an early error. The [production patch](repair.patch)
requires an identifier token and literal spelling at the existing new.target grammar
branch. It adds no host authority or new AST/runtime/snapshot mechanism.

[Final focused check](focused.log): **87 passed / zero failed or skipped**, five files.
Scoped [lint](lint.log) and maintained [build](build.log) exit0; eight built-import
checks pass. Exact commands:

```sh
npx vitest run packages/safe-js/src/parse/new-target-spelling.test.ts
npx vitest run packages/safe-js/src/parse/new-target-spelling.test.ts packages/safe-js/src/parse/classes.test.ts packages/safe-js/src/parse/class-modifier-spellings.test.ts packages/safe-js/src/parse/escaped-keywords.test.ts packages/safe-js/src/snapshot/bound-constructor-new-target.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/new-target-spelling.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

These check strict/sloppy Script, module parsing, lint, class/ordinary functions,
arrow captures, ordinary escaped names, comments, bound constructors, direct eval,
indirect eval and dynamic Function. Failed compilation prevents marker writes;
SyntaxError identity, finally, captured new.target and saved source survive three
pending checkpoint/replay cycles and completed replay. Constructor-chain
process/require access remains absent. The explicit 100-step loop budget rejects
with budgetExceeded/steps. No assertions, deadlines, budgets or runtime support
settings were reduced. Existing compilation-finally cleanup is unchanged.

[Manual QA](qa.md) was executed. The [built CLI screenshot](cli.png) was inspected;
CLI exit1 reports the same location and message as SDK. This parser path explicitly
preserves DisallowedSyntaxError at the public parser boundary (`parser.ts` catch),
while guest eval translates invalid source to SyntaxError. The first independent
SDK probe assumed the ParseError class used by the preceding class repair, so all
seven combined probe exits are failed attempts, preserved in [runtime-sdk.json](runtime-sdk.json).
The [corrected contract probe](runtime-sdk-contract-corrected.json) requires the
actual existing name **and exact message/location**, without changing production
error handling: all seven runtime probes pass. The CLI has the existing plain
DisallowedSyntaxError diagnostic, without a source excerpt; no new layout contract
or unrelated trailing-newline caret fix is claimed.

[Literal upstream commands](commands.json), per-runtime exit receipts and
[hash/mode reconciliation](reconciliation.json) establish **10/10 variants per
runtime** on Node18.18.0/ICU73.2, 18.20.8/74.2, 20.20.0/77.1, 22.23.2/78.2,
24.14.0/78.2 and 26.8.2/78.3. Each report is complete, exit0, with zero failed,
unsupported, metadata or execution-error cases. This includes the original two
failures and eight escaped-new/direct-call/new/ASI controls. Original fixture bytes,
strict/sloppy modes, harness assertions and 3000/10000 ms deadlines are retained.
The prior class cases were not rerun upstream: their exact patch was reviewed,
and the interacting focused class tests were rerun after this parser change.

Bun1.3.11/ICU74.2 passes built SDK/native/replay/budget checks; mapped upstream Bun
execution remains unverified. Workerd remains unexecuted. Available N20/N24 patch
versions do not certify the exact 20.20.2/24.21.0 ledger cells. Published installed
artifacts, other-owner/category reconciliation and full task gates remain open.
The prior residual 173 primary nonpasses minus these two leaves **171 historical
unresolved rows**, before extension/edition dispositions; the 126 secondary resource
nonpasses remain. This is not a fresh whole-selection count. No full package or
repository-wide gate is claimed. All exclusions/unavailable cases remain nonpasses.

This repair receives a separate local commit. No task push, verified remote-main
delivery or release/publication has occurred. The preceding class-modifier repair
is local commit `a43f01b8b549e02ffd4cff78a637e6e41561600b`; its index synchronization
initially met a transient external index lock, then completed after the owner
released it. No lock or unrelated staged changes were deleted.
