# TREE-01 independent validation

## Ownership and baseline

- Independent validator, not implementation author James. Worktree: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, branch `main`, initial HEAD `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Write only `packages/safejs/src/parse/contextual-from-validation.test.ts`, this document, and `out/safejs-remediation/tree-01-validation/**`, using `apply_patch`.
- Author tokenizer, parser, author tests, and author plan are frozen. Other parallel lanes are preserved. No production, README, master-plan, or Git mutation.
- Load the 38 exact exclusions from original `inventory-verification.json#/archiveReadPolicy/excludedPaths` before any nonbootstrap payload. Exclude all of `security/`, including unlisted children. Never read, hash, display, or execute excluded payloads.

## Validation procedure

1. Inspect ancestor/root instructions, author diff, frozen hashes, and allowlisted original fixtures.
2. Add independent tests before execution: binding/scope, keys/methods/member/shorthand, division, supported imports, missing/wrong/escaped separators, unchanged reserved bindings, and separate IP-002 control.
3. Run the unchanged original eight virtual-DOM reconciliation fixtures and three arithmetic-parser fixtures. Establish fresh native results against historical complete outputs and all declared anchors before comparing current TypeScript SafeJS results.
4. Use bounded pure-data execution only: no LLM or guest real I/O; no dist imports. Unit tests create no files. Record full expected/actual values, not only booleans or new author tests.
5. Run focused and relevant parse/runtime tests, scoped ESLint, package and standalone-test typechecks. Record actual failures without weakening assertions or changing frozen code.
6. Rehash frozen author files and original allowlisted inputs. Report new defects for the author and readiness separately from later publisher full gates.

## Gate boundaries

- The reported eleven COLL cursor failures belong to another lane; they must be fixed by its production author, not ignored or described as a clean full suite.
- The reported 181 root TypeScript errors from unbuilt workspace declarations are not TREE-01 defects; do not repair unrelated packages here.
- Local readiness requires the relevant independent tests to pass. Publication additionally requires later clean publisher full gates.
- IP-002 remains separate and is not claimed fixed. No CLI visual change is made; no screenshot test is added.

## Results

**Independent validation complete; not ready for sign-off.** The ordinary contextual-identifier fix works, including all eleven original full workflows, but five independent import-separator rejection tests expose an inherited grammar defect that still requires an author patch. This is not attributed to COLL, workspace declarations, or IP-002, and is not waived because it predates this change.

### Actionable grammar finding: TREE-01-VALIDATION-01

The tokenizer decodes Unicode identifier escapes, and `parser.ts` checks only the decoded `fromToken.value` and token type at the import separator. As a result, all five invalid modules below parse successfully:

```javascript
import value fr\u006fm "fixture";
import value \u0066rom "fixture";
import value fr\u{6f}m "fixture";
import { value } fr\u006fm "fixture";
import * as value fr\u006fm "fixture";
```

- Expected: reject each escaped contextual separator. Fresh native `node --input-type=module --check` rejects all five with exit 1 and `SyntaxError: 'from' must not contain escaped characters`.
- Actual: current `parseModule` accepts all five and produces `ImportDeclaration` nodes. Complete source, native diagnostics, and actual ASTs are retained in `out/safejs-remediation/tree-01-validation/findings.json`.
- Attribution: the original `9ef2e738d` tokenizer and parser, loaded from `git show` and compiled only into child-process memory, also accept all five. This is a newly discovered inherited gap, **not a regression introduced by James**. The same baseline correctly demonstrates the pre-fix rejection of ordinary `const from` and `{ from: 2 }` controls.
- Patch requested from the production author: enforce the literal unescaped contextual separator spelling without rejecting escaped ordinary bindings or keys. Do not restore globally reserved `from`, broadly relax keyword grammar, or treat IP-002 as fixed. Frozen author files were not edited by this validator.
- The five real failing tests remain ordinary failing tests, not skipped or marked expected failures. Independent readiness remains withheld until the author patches the grammar and all relevant tests pass.

### Acceptance and rejection coverage

- Sixteen composite programs match complete native values: nested closure/scope, recursion, destructuring/defaults/rest, loop and catch bindings, methods/receivers, member assignment and optional access, shorthand/spread, escaped identifiers/keys, comments, nested template division, and regex/division distinction.
- Ten supported imports resolve exclusively against a bounded in-memory fixture module, including default/namespace/named/aliased bindings called `from`, escaped ordinary local bindings, trailing commas, comments, and newlines.
- Eighteen missing/wrong separator or malformed source/alias cases reject. A contextual separator remains required; the remaining defect is acceptance of its escaped spelling, not acceptance of a missing token.
- Eight reserved-binding controls reject in both native and SafeJS; `import`/`as` remain keyword tokens. The inspected production diff removes only `from` from the keyword set and changes only the import-separator check. It does not globally loosen identifier/property-name parsing.
- The first test execution reported 53 passed / 6 failed: five genuine separator failures and one validator assertion incorrectly expecting `run` to return a failure rather than reject its promise for IP-002. Only that validator assertion was corrected. Final focused result is 54 passed / 5 failed. No production behavior was changed to satisfy tests.

### Original full workflow evidence

`out/safejs-remediation/tree-01-validation/original-workflows.json` retains **complete original inputs, complete historical expected values, complete fresh native and current SafeJS actual values, every declared field anchor, operation checks, process status, and guest step counts**. No result is reduced to the newly added unit tests or an output-prefix check.

All eleven fresh native runs were checked against historical full outputs and authored anchors before any of the eleven SafeJS runs. Original source hashes match the historical fixture hashes. Native execution uses the unchanged source, not compatibility rewrites; SafeJS imports current TypeScript source, not `dist`.

| Original fixture | Complete historical/native/SafeJS parity | SafeJS steps |
| --- | --- | ---: |
| `02-append` | pass | 666 |
| `02-prepend` | pass | 807 |
| `02-remove` | pass | 659 |
| `02-rotate` | pass | 1005 |
| `02-mixed` | pass | 1279 |
| `02-replace-all` | pass | 726 |
| `02-unkeyed` | pass | 384 |
| `02-reverse` | pass | 1269 |
| `precedence-order` | pass | 1878 |
| `precedence-right-power` | pass | 2382 |
| `precedence-unary-groups` | pass | 2867 |

Tree comparisons include the entire resulting tree, alignment, move plan, full ordered trace with IDs, reused keys, and identity origins; all explicit exact/required operation anchors pass. AST comparisons include the entire AST and the prefix/value/node-count anchors, not just computed arithmetic values. The AST fixtures are compatibility controls, not additional TREE-01 defect claims.

Execution bounds: each child has a 10-second hard timeout, 192 MiB old-space limit, and 1 MiB output cap. Each SafeJS run uses 200,000 steps, depth 96, string length 65,536, array length 2,048, data size 1 MiB, and a four-second deadline. Modules are empty; no guest real I/O or LLM capability is supplied. Unit tests create no files.

### IP-002 remains separate

The unchanged original `iterable-pipelines/reductions/07-return-method.js` was also executed independently. Native returns the complete expected value:

```json
[{"id":"method","result":[{"value":1,"done":false},{"value":"closed","done":true}],"beforePull":[]}]
```

Current SafeJS rejects with `ParseError: Unexpected token 'return' at line 5, column 3.` and zero guest steps. The functional probe process exits zero because the driver serializes the error; this is explicitly an API/parser failure, not a passing workflow. Full error/span and native output are retained under `original-workflows.json#/ip002`. This separate historical discrepancy is unchanged and not claimed fixed.

### Commands and gates

All commands run in the fix worktree. `out/safejs-remediation/tree-01-validation/commands.json` retains exact arguments, timestamps, exit codes, full stdout/stderr for captured gates, and the complete native/current/baseline/original-workflow child programs. Native module grammar checks use stdin and never resolve imports.

| Command | Final result |
| --- | --- |
| `node_modules/.bin/vitest run packages/safejs/src/parse/contextual-from-validation.test.ts` | exit 1; 54 passed / 5 escaped-separator failures |
| `node_modules/.bin/vitest run packages/safejs/src/parse` | exit 1; 313 passed / same 5 failures / 1 opt-in fuzz skip; 11 files pass, 1 fails, 1 skips |
| `node_modules/.bin/vitest run packages/safejs/src/run.test.ts packages/safejs/src/lint.syntax-parity.test.ts packages/safejs/src/lint/rules/AS-unused-import.test.ts packages/safejs/src/lint/rules/AS-export-import-meta.test.ts packages/safejs/src/lint/rules/module-registry.test.ts` | exit 0; 114 passed across 5 files |
| `node_modules/.bin/eslint packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/tokenizer.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/parser.test.ts` | exit 0; no diagnostics |
| `node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json` | exit 0 |
| `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/contextual-from-validation.test.ts` | exit 0; includes the new test itself |
| `node_modules/.bin/prettier --check packages/safejs/src/parse/contextual-from-validation.test.ts` | initial formatting check exit 1; formatted only this owned file using `apply_patch`; final exit 0 |
| `node --input-type=module --check` with each escaped-separator module on stdin | all 5 exit 1 with the expected native syntax rejection |
| Bounded original workflow child commands retained in `commands.json#/originalWorkflows` | all 22 native/SafeJS runs exit 0; all 11 full parity checks pass |
| Original IP-002 child commands | both processes exit 0; native value matches, SafeJS API fails as recorded above |

The root workspace typecheck and full SafeJS suite were not rerun. The user-reported 181 root declaration errors and author-reported 4,107 passes / 11 COLL failures / 34 skips are external context, **not independently revalidated results or clean gates**. This lane introduces five additional visible grammar failures until the author corrects them. Later clean publisher full gates remain mandatory even after this lane passes.

### Changed paths and preservation

Only the new independent test, this validation document, and four evidence files under `out/safejs-remediation/tree-01-validation/` are written: `findings.json`, `original-workflows.json`, `commands.json`, and `provenance.json`. All file edits use `apply_patch`. No production, README, master plan, author file, or other lane is edited; no Git mutation or release is performed.

`provenance.json` records the exact bootstrap exclusions, all allowlisted audit input hashes, before/after frozen author hashes, and preservation checks. The entire original security directory and all 38 exact excluded paths remain unread/unexecuted; only metadata about their paths is used.

| Frozen author path | SHA-256, unchanged before/after |
| --- | --- |
| `packages/safejs/src/parse/tokenizer.ts` | `380af40a787118c2abdcb28eab78d7f04d733bde5db50f5e597d05a4ff81483e` |
| `packages/safejs/src/parse/parser.ts` | `9b7e68ace8c7c9dbe13e694548367646c2c1e7a0f550744c88da55ea92b1ae35` |
| `packages/safejs/src/parse/contextual-from.test.ts` | `1c18d28def1adc7ce775c339b11d360b067e923460913c3eca1f94a26d039149` |
| `packages/safejs/src/parse/parser.test.ts` | `c001c3f40c3ac2786eab2e3e25ebf53429de6a9174db69ceac144171192fbaa1` |
| `docs/plans/safejs-fix-tree-01.md` | `79cabd3432801824c4e763a6388d6b6463cd0ef92ae3d804933422368f4c6c35` |

## Fresh independent repair revalidation — 2026-08-29T04:07:47.440Z

**Current verdict: READY for publisher handoff of the exact captured TREE-01 candidate.** No TREE-01 blocker remains in the requested finite scope. This dated addendum supersedes the earlier withheld verdict for current readiness only; every earlier failure, command, and evidence artifact remains historical and unchanged. This is not publication, a full-grammar claim, or a claim that publisher full gates have run.

### Repair and finite scope

- Independently verified repaired parser SHA-256 `8e6c8b4e5d2d5484dcf5149f5a55da7d6427e0ed62444fe079ec64ee1f1ff114`. The added raw-token span-length check rejects escaped contextual separators without changing the ordinary identifier lexer. No production or test edits were made in this revalidation.
- The same five formerly blocked separator programs now reject in current SafeJS and fresh native module syntax checks. Current errors are `Expected 'from'` at columns 14, 14, 14, 18, and 19 respectively; all five native checks reject escaped separators. No new grammar matrix was introduced.
- The unchanged independent test file remains SHA-256 `3fae78429c12f7232318e60f40aa580290f4bc14b090f3b939e12f9836be899e`. Its existing escaped ordinary binding, escaped method key, escaped import local, missing-separator, ordinary scope/key/member/shorthand, and reserved-keyword controls all pass.
- The existing IP-002 control still observes its separate return-method rejection. IP-002 is not claimed fixed; its original historical error evidence is retained, not relabeled as a successful workflow.

### Fresh commands and actual results

| Command | Independently observed result |
| --- | --- |
| `node_modules/.bin/vitest run packages/safejs/src/parse/contextual-from-validation.test.ts` | exit 0; 59 passed / 0 failed |
| `node_modules/.bin/vitest run packages/safejs/src/parse` | exit 0; 318 passed / 0 failed / 1 opt-in fuzz skip; 12 files pass / 1 skips |
| `node_modules/.bin/vitest run packages/safejs/src/run.test.ts packages/safejs/src/lint.syntax-parity.test.ts packages/safejs/src/lint/rules/AS-unused-import.test.ts packages/safejs/src/lint/rules/AS-export-import-meta.test.ts packages/safejs/src/lint/rules/module-registry.test.ts` | exit 0; 114 passed across 5 files |
| `node_modules/.bin/eslint packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/tokenizer.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/parser.test.ts` | exit 0; no diagnostics |
| `node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json` | exit 0; no diagnostics |
| `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts` | exit 0; no diagnostics |
| `node_modules/.bin/prettier --check packages/safejs/src/parse/parser.ts packages/safejs/src/parse/contextual-from-validation.test.ts` | exit 0; both files formatted |
| `node --input-type=module --check` with each of the same five invalid modules on stdin | 5 expected native syntax rejections, each exit 1; no import resolution |
| Retained current parser driver in `commands.json#/currentParser` | exit 0; all same 5 sources produce `accepted: false` |
| Retained bounded original-workflow driver in `commands.json#/originalWorkflows` | 22 child executions exit 0; 8/8 tree and 3/3 AST complete-output/anchor comparisons pass |

Fresh complete command output and finite native/current grammar evidence: `out/safejs-remediation/tree-01-validation/repair-revalidation.json`. The earlier command/evidence files were not overwritten.

### Original fixtures, not replacement reductions

The exact original eight tree fixtures and three AST fixtures were rerun against their original full historical expected values. Every fresh native result and all declared anchors were verified before the first SafeJS execution. Full expected/actual values, original inputs, source hashes, exact/required operation checks, and step counts are retained in `out/safejs-remediation/tree-01-validation/repair-original-workflows.json`. Tree outputs include the entire tree, alignment, moves, ordered trace/IDs, reused keys, and child origins; AST outputs include the entire AST, prefix, arithmetic value, and node count.

| Original fixture | Fresh full parity | SafeJS steps |
| --- | --- | ---: |
| `02-append` | pass | 666 |
| `02-prepend` | pass | 807 |
| `02-remove` | pass | 659 |
| `02-rotate` | pass | 1005 |
| `02-mixed` | pass | 1279 |
| `02-replace-all` | pass | 726 |
| `02-unkeyed` | pass | 384 |
| `02-reverse` | pass | 1269 |
| `precedence-order` | pass | 1878 |
| `precedence-right-power` | pass | 2382 |
| `precedence-unary-groups` | pass | 2867 |

The original source hashes remain `1d26b46870e4fd1c1cc961c127c5dcc0dc62930e7bbf93b78cd216a0bbe76bcf` (tree) and `1bdcdc4192025f40c2d607f20344f87175783fcf197e5ccc64fa6aa9a1ba478d` (AST). Before any original payload read, all 38 exact metadata exclusions and the entire security directory were excluded. Only the same six tree/AST source/fixture/oracle files were read; no broad audit search or excluded payload read occurred. Child limits remain 10 seconds / 192 MiB / 1 MiB output, with the previously documented bounded SafeJS budgets, empty modules, and current TypeScript imports. No guest real I/O, LLM, or dist execution occurred.

### Exact immutable candidate and publisher boundary

- Candidate base HEAD: `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`. Capture exactly the seven requested repo-relative payload paths beneath `out/safejs-remediation/tree-01-validation/candidate/`, preserving their repository directory structure. The manifest is outside that directory at `out/safejs-remediation/tree-01-validation/candidate-manifest.json`, so the candidate directory contains exactly seven files.
- The manifest records each repo-relative path, captured path, SHA-256, byte count, validated hash, and base-HEAD preimage existence/hash/byte count/Git blob/content. The report is captured after this append-only verdict. Captured payload bytes must equal the pinned, independently validated bytes and the live source at capture. Payloads and manifest are sealed read-only after integrity verification; hashes define the publisher contract.
- Publisher must use captured bytes, never later shared live parser files. Later live edits for IP-002 do not authorize substitution into this candidate. If any captured hash or publisher preimage check differs, stop rather than silently replacing bytes.
- This validation clears TREE-01 for the existing serial publisher queue, not an immediate or parallel push. Publication still requires clean publisher full gates and release monitoring; earlier other-lane/root-workspace failures are not waived. No staging, commit, pull, push, branch, README, production, or other-lane modification was performed here.
- Earlier report bytes remain an exact prefix. The four historical evidence files retain their prior hashes. Only this report is appended; new evidence and immutable captures are written under the owned output directory.
