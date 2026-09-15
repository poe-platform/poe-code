# Regexp lexical goal after declarations — 2026-09-13

Sixteen independent regressions failed and thirteen controls passed before repair.
Function/class declaration bodies were classified as expression-ending braces. The
lexer now tracks declaration headers and their grouping context, including async and
generator functions, class heritage and exports. Newly encountered tokens are processed
once rather than repeatedly scanning the entire token history. Template interpolation
uses the same decisions. Function/class expressions continue to use division.

Final focused checks pass93 tests/four files (31 new cases). The broader parser/lint
selection passes2537 tests/139 files; the existing opt-in fuzz test/file is skipped and
is not counted as a pass. ESLint and the maintained workspace build pass, including
eight built-import checks. No assertions, budgets, runtime support or timeouts changed.

Commands:

```sh
npx vitest run packages/safe-js/src/parse/declaration-regexp-goal.test.ts
npx vitest run packages/safe-js/src/parse/declaration-regexp-goal.test.ts packages/safe-js/src/parse/block-regexp-goal.test.ts packages/safe-js/src/parse/tokenizer.test.ts packages/safe-js/src/parse/template-regex-boundaries.test.ts
npx vitest run packages/safe-js/src/parse packages/safe-js/src/lint
npx eslint packages/safe-js/src/parse/tokenizer.ts packages/safe-js/src/parse/declaration-regexp-goal.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Original-context replay passes24 variants/12 files: all16 original failures and their
recorded neighbors, zero unsupported/metadata/execution errors. `command.json` records
exact selection and invocation; `reconciliation.json` verifies original fixture hashes
and modes. Source base f56c79a787298b02070df8ee93a8003c1453e1a1 plus recorded patch,
fingerprint eb61c7158610274a7ab0d12e18b11839abe15deffd50ea9f4f89e197400084c5;
Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, ECMA-262 edition16/402 edition12,
Node22.23.2/ICU78.2, unchanged3000ms variant/10000ms startup deadlines.

Built SDK checks pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. Three pending and completed replay,
exact saved declaration source, constructor host-escape denial and100-step budget
control pass. CLI screenshot inspected and agrees with SDK; no lint diagnostics.
Sibling workspaces resolve to delivery sources under the recorded matching-external-lock
qualification, not a fresh npm ci.

Residual arithmetic:92 raw nonpasses, including49 explicit exclusions and43 target
failures. This is not a full corpus rerun or whole-task completion. Local commit,
remote ancestry and eventual publication receipts are separate delivery gates.
