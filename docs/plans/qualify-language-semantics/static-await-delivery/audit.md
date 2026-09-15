# Static-block await grammar delivery — 2026-09-13

Source e69000eb0 (full SHA in upstream header), Node22.23.2/ICU78.2, Darwin arm64.
The delivered language audit reproduced missing static-block early errors that the
error-completion task previously repaired only in an uncommitted working tree.
Reused its exact recorded static-catch-await regression and restricted-owner patch;
original working files and staged changes remain untouched. The two patch hunks
preserve the static await grammar parameter and contextual resource-binding recognition
across ordinary function boundaries. Resource management remains an explicitly tracked
extension, not an implicit expansion of the ECMA-262 edition16 target. Test262 remains
419d3e0a2273ba01a3bfcbec423f2801425b8e93; ECMA-402 edition12 and extension pins unchanged.

Before repair: **nine failing regressions/five passing controls**. After repair:
**92 tests/four files** pass, plus **155 tests/three files** covering contextual arrow
parameters/function names and class evaluation. Zero skips. The first command also
listed nonexistent lexical-context.test.ts; no tests from that missing path are counted.
Exact commands:

```sh
npx vitest run packages/safe-js/src/parse/static-catch-await.test.ts packages/safe-js/src/parse/let-await-yield-lookahead.test.ts packages/safe-js/src/parse/class-modifier-spellings.test.ts packages/safe-js/src/parse/eval-script.test.ts packages/safe-js/src/parse/lexical-context.test.ts
npx vitest run packages/safe-js/src/parse/contextual-arrow-parameters.test.ts packages/safe-js/src/parse/contextual-function-names.test.ts packages/safe-js/src/interp/classes.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/static-catch-await.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Scoped lint and maintained build pass, including eight built-import checks. The
recorded upstream selection is reused exactly: **38 files/76 variants/74 passed/two
failed**, zero unsupported or metadata/execution errors. Original fixture hashes,
strict/sloppy contexts and 3000ms/10000ms deadlines remain unchanged. Both failures
are static-init-await-binding-valid.js: the parser still rejects a class named await
inside an ordinary arrow body. This independently reproduced class-name bug is a
separate atomic repair; this report is unsuccessful and is not described as 76 passes.
No whole suite is repeated, no timeout/assertion/budget/support or host authority changed.

The parent delivered-source audit contains205 nonpasses. Reentry has its separately
verified six-case repair. Residual language/other-owner/runtime/recovery/publication
acceptance stays open. Shared installed dependencies are explicit; disk capacity blocked
a fresh install. Local commit, remote delivery and publication receipts are separate.

Built CLI screenshot inspected: success `[true,"SyntaxError"]`, matching the SDK eval early-error regression. Command: `npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/static-await-delivery/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/static-await-delivery/smoke.ajs`.
