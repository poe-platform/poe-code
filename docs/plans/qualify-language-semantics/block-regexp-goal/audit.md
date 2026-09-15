# Regexp lexical goal after statement blocks — 2026-09-13

Eleven independent regressions fail and six controls pass before repair. The lexer
always treated a closing brace as expression-ending, so valid regexp statements after
blocks became division tokens. Script/module entry points now provide the statement-list
goal; brace contexts distinguish statement lists from expression-ending object/function
bodies. Template scanning uses the same grouping decisions. Legacy expression parsing
and template object division retain their expression goal.

Expanded independent controls exposed method-name/control-keyword ambiguity, dynamic
function-body goals and for-await block context. Their red reports are retained before
repairing those interactions. Switch/if method calls preserve division; all four dynamic
function kinds accept block/regexp statements. Final focused checks pass149 tests/five
files, including24 independent cases. Lint and maintained build pass, including eight
built-import checks. No assertions, limits, timeouts or runtime support were weakened.

```sh
npx vitest run packages/safe-js/src/parse/block-regexp-goal.test.ts
npx vitest run packages/safe-js/src/parse/block-regexp-goal.test.ts packages/safe-js/src/parse/tokenizer.test.ts packages/safe-js/src/parse/template-regex-boundaries.test.ts packages/safe-js/src/parse/lexical-regexp-qualification.test.ts packages/safe-js/src/interp/globals/dynamic-function.test.ts
npx vitest run packages/safe-js/src/parse packages/safe-js/src/lint
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/tokenizer.ts packages/safe-js/src/parse/block-regexp-goal.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

The broader parser/lint run passed2505 tests/138 files, with the existing opt-in fuzz test
skipped (one test/file); it is not counted as a pass. That run precedes the final for-await
predicate addition; the final149-test selection covers that addition and its neighbors.
The final original-context rerun passes24 variants/12 files:16 original failures and
recorded neighbors, zero unsupported/metadata/execution errors. Exact source SHA/patch/
fingerprint, fixture hashes/modes and commands are retained. Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93,
ECMA-262 edition16/ECMA-402 edition12, Node22.23.2/ICU78.2 and3000ms/10000ms deadlines
remain pinned. Sibling workspaces resolve to delivery sources; external dependencies
remain shared under the matching-lock qualification.

Built SDK probes pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. They preserve three pending plus completed
replays, exact regexp-containing function source, dynamic bodies, for-await blocks,
constructor host-escape denial and a100-step infinite-loop budget. CLI screenshot
inspected; its result agrees with SDK. Exact commands/results are saved.

Sixteen original failures are repaired. Residual arithmetic becomes108 raw nonpasses,
including49 already-dispositioned exclusions and59 target failures. Regexp statements
after function/class declarations remain a separate unresolved category. Whole-task
acceptance and final containing-successor publication remain open.
