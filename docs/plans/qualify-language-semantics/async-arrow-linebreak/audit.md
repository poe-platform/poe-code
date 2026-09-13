# Async identifier line-break qualification — 2026-09-13

The recorded strict/sloppy async-lineterminator-identifier-throws.js variants fail
because SafeJS raises a parse SyntaxError for `async` followed by a newline and
`x=>x`. The grammar's no-LineTerminator restriction excludes the async-arrow
production; ASI allows two statements and the unbound async identifier instead
raises runtime ReferenceError. The lookahead now returns false on that line break,
preserving the later no-line-break-before-arrow and parenthesized-call restrictions.

Independent red: five failures/three invalid-grammar controls passing. Green:
87 tests/four files, zero skips; scoped lint and maintained SafeJS build pass,
including eight built-import checks. Exact commands:

```sh
npx vitest run packages/safe-js/src/parse/async-arrow-linebreak.test.ts
npx vitest run packages/safe-js/src/parse/async-arrow-linebreak.test.ts packages/safe-js/src/parse/contextual-arrow-parameters.test.ts packages/safe-js/src/parse/let-await-yield-lookahead.test.ts packages/safe-js/src/parse/eval-script.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/async-arrow-linebreak.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Reused the exact recorded fixture and passing neighbor: two files/four variants,
all passed, zero unsupported/errors. Source884ead8b709899f07aa4fe7676f4cfe9a84d3f76
plus this patch, exact fingerprint in reconciliation.json. Node22.23.2/ICU78.2,
Darwin arm64. Original Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, published
ECMA-262 edition16/ECMA-402 edition12 and explicit extension targets are unchanged.
Original hashes/modes and3000ms/10000ms deadlines remain. No budgets/assertions,
runtime support or host authority were weakened; complete suites were not repeated.

New coverage verifies literal/comment/Unicode line breaks, runtime error identity,
lint acceptance, ordinary/dynamic functions, original arrow source, three pending
checkpoint/replay cycles, completed replay and constructor host-escape controls.
Built SDK commands in runtime-sdk.json pass Node18.18.0/ICU73.2,18.20.8/74.2,
20.20.0/77.1,22.23.2/78.2,24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. These are
bounded cells, not complete Workerd/runtime conformance. Built CLI screenshot was
inspected: clear `["ReferenceError",true]`, matching SDK. Capture command:
`npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/async-arrow-linebreak/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/async-arrow-linebreak/smoke.ajs`.

The last full focused report retains161 nonpasses; this two-variant repair reduces
residual accounting to159, not a fresh complete report. All other case/exclusion,
runtime/recovery and publication blockers stay open. Local commit, remote ancestry
and actual publication are separate receipts. Shared dependencies and prior ENOSPC
setup limitations remain explicitly documented in the delivery audit.
