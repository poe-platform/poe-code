# Contextual class binding delivery — 2026-09-13

While replaying the static-block repair's recorded controls, the clean candidate
still rejected `class C {static {(()=>{class await {}})}}`. Independently reproduced
`class await {}` and escaped spelling in strict/sloppy Script and ordinary-function
contexts. Six new regressions fail; four forbidden-binding controls pass. Native
Script accepts the five valid controls and rejects async/static-block await and
strict class yield/eval bindings. The class parser's binding lookahead omitted
contextual identifiers. Use its existing contextual-identifier predicate before
normal binding validation; no grammar checks are bypassed.

This one-line repair also exists among the original module-audit working changes,
but those changes were not delivered or presumed passing. The original uncommitted
file is preserved. This is an independent regression and separate atomic commit from
the preceding static-block grammar integration. Parent d207d1ed9; exact source SHA,
fingerprint and Node22.23.2/ICU78.2 are in reconciliation.json. Target remains
ECMA-262 edition16/ECMA-402 edition12 plus the same explicit extensions, and Test262
419d3e0a2273ba01a3bfcbec423f2801425b8e93. No authority, runtime, budget, assertion or
deadline is relaxed. Host constructor escape controls continue to return undefined.

Manual validation:

```sh
npx vitest run packages/safe-js/src/parse/class-await-binding.test.ts
npx vitest run packages/safe-js/src/parse/class-await-binding.test.ts packages/safe-js/src/parse/static-catch-await.test.ts packages/safe-js/src/parse/classes.test.ts packages/safe-js/src/parse/contextual-function-names.test.ts packages/safe-js/src/parse/contextual-arrow-parameters.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/class-await-binding.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

**123 tests/five files pass**, zero skips. Tests retain ordinary/dynamic function and
eval behavior, class instance identity/name/source, three pending checkpoint/replay
cycles, completed replay and absent process/require through constructors. Lint passes.
The recorded class-name failures and neighbors are combined with the earlier38-file
static-await selection, not a complete suite: **44 files/88 variants/88 passes**, zero
failures/unsupported/metadata/execution errors. The two previously failing static-block
controls now pass. Original hashes/modes and3000ms/10000ms deadlines are verified.

Whole-task acceptance remains open. The source-changing final primary replay will
supersede residual arithmetic; the complete V4 historical report remains unchanged.
Runtime matrix, remaining language nonpasses, other-owner/resource categories and
release/artifact gates are not closed by these focused passes. Source provenance,
local commits, verified remote main and actual package publication remain separate.

Maintained build passes, including eight built-import checks. Built SDK static early
errors, class identity/source, dynamic constructors, host isolation and three pending
plus completed replay cycles pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,
22.23.2/78.2,24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2 (`runtime-sdk.json`).
The built CLI screenshot was inspected: clear success `["await",true]`, matching SDK.
Command: `npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/class-await-delivery/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/class-await-delivery/smoke.ajs`.
