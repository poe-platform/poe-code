# Parenthesized assignment naming — 2026-09-13

The two recorded fn-name-lhs-cover.js variants require `(fn)=function(){}` to retain
an empty name. SafeJS discarded target grouping and inferred fn. Ten independent
regressions fail before repair, including ordinary/arrow/generator/async functions,
classes, ordinary/logical assignments, explicit names and source/replay. Native Script
controls confirm the expected names/descriptors. The parser now preserves the grouped
left-hand-side fact; the interpreter suppresses identifier name inference only for
that grouped target. Explicit names, plain identifier assignment and member assignment
retain their existing behavior. No host authority, limits or syntax checks are relaxed.

New and parenthesized-target tests pass25 tests/two files. The initial command also
listed nonexistent functions.test.ts and assignment.test.ts; neither is counted as
executed. Discovered maintained neighbor names and ran141 further tests/four files.
Exact commands:

```sh
npx vitest run packages/safe-js/src/interp/parenthesized-assignment-name.test.ts
npx vitest run packages/safe-js/src/interp/parenthesized-assignment-name.test.ts packages/safe-js/src/parse/parenthesized-pattern-targets.test.ts packages/safe-js/src/interp/functions.test.ts packages/safe-js/src/interp/assignment.test.ts
npx vitest run packages/safe-js/src/interp/anonymous-function-names.test.ts packages/safe-js/src/interp/methods/function.test.ts packages/safe-js/src/interp/globals/dynamic-function.test.ts packages/safe-js/src/interp/globals/dynamic-assignment.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/parenthesized-assignment-name.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

All executed tests have zero skips. Lint and maintained build pass, including eight
built-import checks. Original upstream fixture and recorded neighbor: two files/four
variants, all passed, zero unsupported/errors. Exact source SHA/fingerprint, original
fixture hashes/modes, Node22.23.2/ICU78.2 and unchanged3000ms/10000ms deadlines are in
reconciliation.json. ECMA-262 edition16/ECMA-402 edition12, explicit extensions and
Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93 remain unchanged.

Built SDK original, three pending and completed replay checks pass Node18.18.0/ICU73.2,
18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2.
They retain anonymous/explicit names, exact generator source, generator progress and
constructor host-escape controls. The CLI screenshot was inspected: `["","named"]`
matches SDK. Command: `npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/parenthesized-assignment-name/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/parenthesized-assignment-name/smoke.ajs`.

Residual accounting becomes157 nonpasses after this two-case repair and the separately
committed async-line-break repair. That is not a new complete run. Remaining categories,
Workerd/full runtime/recovery and publication gates stay open. Shared dependency and
ENOSPC setup qualifications remain. Local commit, verified remote delivery and actual
published artifacts are separate receipts; no complete language qualification is claimed.
