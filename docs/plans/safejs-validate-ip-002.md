# IP-002 independent validation

## Scope and ownership

- Direct independent validation worker, not author James. Parent orchestrates publication.
- Worktree `/Users/kjopek/Workspace/poe-code-safejs-keyword-methods`; base `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`.
- Frozen author manifest `out/safejs-remediation/ip-002/hash-manifest.json`, SHA-256 `3a99fd97cb6f7f3399bf20959f6322f0ab4f1ea06ecafaaa49c2cd09b3ed38b6`. All four publishables and immutable copies match the manifest; production changes are limited to the author's parser.
- Validator owns only the new `packages/safejs/src/parse/keyword-methods-validation.test.ts`, this document, and `out/safejs-remediation/ip-002-validation/**`. File writes use `apply_patch`. No production, existing author/test/evidence, README, other-clone, or Git mutation.
- Bootstrap the exact 38 original exclusions from `inventory-verification.json#/archiveReadPolicy/excludedPaths`, plus the entire original security directory, before payload reads. Read only `iterable-pipelines/examples/03-tee-shared-cache.js`, `iterable-pipelines/reductions/07-return-method.js`, `keyword-method-review/expected.json`, and `keyword-method-review/contract-classification.json` through an explicit guard. No recursive audit search or excluded payload read/hash/execution.

## Procedure

1. Pin author candidate and relevant unchanged TREE anchors before tests.
2. Write finite independent native/runtime/replay tests for keyword methods and async-computed composition; distinguish unsupported accessors/generators from illegal bindings/shorthand/modifiers. Preserve TREE separator controls without broadening the contract.
3. Demonstrate genuine baseline RED with original base parser bytes loaded only in child-process memory; never replace live production files. Execute untouched original tee and reduction against full manual expected values, fresh native results, current SafeJS, and completed replay when supported.
4. Run focused, actual package, broad, configured/new-test TypeScript, ESLint, formatting, and build gates as needed with TERM unset and snapshot playback-only settings. No LLM or guest real I/O.
5. Preserve every failure and limit. If ready, capture exact publishables, base/current preimages, hashes, and the report SHA. Publisher must verify preimages and pass fresh full gates before release.

## Boundaries

- This is not complete ECMAScript support. Accessors, generator shorthand, and reserved bare data keys stay outside this repair's supported contract; native acceptance alone does not request their implementation.
- NUM-001 source arity is unmerged and remains pending. No test or result here claims it fixed.
- No new production fix, publication, or visual CLI change is authorized. Existing immutable TREE clone/candidate remains untouched.

## Results

Independent execution in progress. Detailed commands, complete original outputs, baseline attribution, failures/limits, and candidate verdict will be appended after validation.

## Independent verdict — 2026-08-29T06:41:03.629Z

**READY for exact captured-candidate publisher handoff.** No remaining IP-002 or async-computed companion blocker was found in the finite validated contract. This verdict does not publish anything, approve unrelated work, or waive future publisher preimage verification and fresh full gates. NUM-001 source arity remains unmerged/pending and is not claimed fixed.

### Genuine independent RED and unchanged-source GREEN

The validator extracts the static corpus declarations from its own test using the TypeScript AST, then executes the entire programs through `parseModule`. The baseline child reads the actual parser from Git object `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f:packages/safejs/src/parse/parser.ts`, transpiles only in memory, and installs it in its own module cache. The live parser is never replaced. Its preimage SHA-256 is `8e6c8b4e5d2d5484dcf5149f5a55da7d6427e0ed62444fe079ec64ee1f1ff114`.

- Baseline: **14 failing / 34 passing decisions** across the independent 48-program grammar corpus. All 14 are native-valid supported programs rejected by the actual base parser, covering keyword method names and the separately assessed async-computed/literal companion. This is a direct baseline probe, not a claim to have rerun the author's 44-failure Vitest baseline.
- Current: **48/48 grammar decisions correct** against the exact same corpus and native syntax checks: 17 supported programs accepted, 23 native-invalid forms rejected, and 8 native-valid but explicitly unsupported accessor/generator forms refused with the expected diagnostic.
- Independent Vitest file: **59/59 passed**, including those cases plus ten AST metadata checks and one keyword-token/non-method gate check. Each of the 17 supported programs also matches its complete manually specified/native value and serialized completed-snapshot replay. No tests create files; snapshots are serialized and parsed in memory.
- Coverage distinguishes keyword method names from illegal binding/parameter/shorthand uses; ordinary and async methods named `async`, `get`, and `set` from actual modifiers/accessors; named/computed/string/numeric companion forms; escaped names from escaped modifiers; LF, CR, CRLF and newline-containing comments from legal name-to-parenthesis or computed-key internal line breaks. No new unsupported feature matrix or source rewrite is introduced.
- TREE ordinary/escaped `from` bindings/keys and all five escaped import-separator rejection regressions remain in the unchanged current TREE test file and pass. The author's only change to that file is its obsolete IP-002 rejection assertion becoming success. The original shared TREE clone and capture are untouched.

### Original full tee and return-method reduction

Both exact original programs were read only through the bootstrap-guarded allowlist. The complete manual oracle in `keyword-method-review/expected.json` is checked before comparing current or replay outputs. Fresh native results match it in full; no fixture, method spelling, or source text is rewritten.

| Original program                                     | Baseline actual                                          | Current actual                        | Completed replay                      |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| `iterable-pipelines/examples/03-tee-shared-cache.js` | ParseError at 54:5, `Unexpected token 'return'`, 0 steps | Full native/manual match, 4,076 steps | Full native/manual match, 4,076 steps |
| `iterable-pipelines/reductions/07-return-method.js`  | ParseError at 5:3, `Unexpected token 'return'`, 0 steps  | Full native/manual match, 28 steps    | Full native/manual match, 28 steps    |

The tee comparison includes all four original scenarios (interleaved, abandon-one, close-both, unstarted-close), every value and operation state, complete ordered traces, alias/shared-step/shared-mutation flags, pre-pull state, final base/produced/cache/closed state, pull counts, and close counts. The reduction returns the complete expected next/return records. `out/safejs-remediation/ip-002-validation/original-workflows.json` retains complete expected/actual values, baseline errors/spans, replay outputs, source hashes, and child status—not just summary booleans. Baseline driver processes exit zero because they serialize parser errors; the contained API failures are explicitly RED, not passes.

The child caps are 10 seconds, 192 MiB old-space, and 1 MiB output; current/replay budgets are 200,000 steps, depth 96, 65,536 string length, 2,048 array length, 1 MiB data, and a four-second deadline each. Probe modules are empty, with no guest real I/O or LLM capabilities. Native uses unchanged function-body source; SafeJS uses current TypeScript, not dist.

### Fresh independent gate results

All commands run in this isolated clone with TERM unset. Test gates enforce snapshot playback and error on missing snapshots; full repository execution also disables skill synchronization. Full stdout/stderr and exact command arguments are retained in `out/safejs-remediation/ip-002-validation/commands.json`.

| Command                                                                                                                                                                                                                                                                                                                          | Actual result                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TSX_DISABLE_CACHE=1 node_modules/.bin/vitest run packages/safejs/src/parse/keyword-methods-validation.test.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                    | exit 0; 193 passed across 3 files                                                            |
| `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TSX_DISABLE_CACHE=1 node_modules/.bin/vitest run packages/safejs/src/parse packages/safejs/src/run.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/lint.syntax-parity.test.ts`           | exit 0; 1,037 passed / 1 opt-in fuzz skip; 18 passing files                                  |
| `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TSX_DISABLE_CACHE=1 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/npm run test:unit --workspace @poe-code/safejs`                                                                                                                                                | exit 0; 4,609 passed / 39 existing skips; 154 passing files                                  |
| `env -u TERM /Users/kjopek/.nvm/versions/node/v22.22.2/bin/npm run lint:types`                                                                                                                                                                                                                                                   | exit 0; no error diagnostics                                                                 |
| `env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json`                                                                                                                                                                                                                                                    | exit 0; no error diagnostics                                                                 |
| `env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/parse/keyword-methods-validation.test.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts` | exit 0; no error diagnostics                                                                 |
| `env -u TERM /Users/kjopek/.nvm/versions/node/v22.22.2/bin/npm run lint:eslint`                                                                                                                                                                                                                                                  | exit 0; no error diagnostics                                                                 |
| `env -u TERM node_modules/.bin/eslint packages/safejs/src/parse/keyword-methods-validation.test.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                                                           | exit 0; no error diagnostics                                                                 |
| `env -u TERM node_modules/.bin/prettier --check packages/safejs/src/parse/keyword-methods-validation.test.ts packages/safejs/src/parse/parser.ts packages/safejs/src/parse/keyword-methods.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`                                                                 | exit 0; all four selected files formatted                                                    |
| `env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error TSX_DISABLE_CACHE=1 npm run test:unit`                                                                                                                                                                                                        | exit 0; **21,994 passed / 41 existing skips; 944 passing files / 3 skipped**; 206.93 seconds |

The full repository total is the author's 21,935 plus the new 59 independent tests. No new skip or expected-failure test is introduced. Existing package/repository skips remain visible; this is not an unskipped completeness claim. The configured package suite, including its existing tests, and the configured full unit suite were run; no separate adversarial/security audit campaign or original excluded-payload execution occurred. The full suite emits expected fixture diagnostics on stderr; raw output is retained and its final exit/test counts are green.

Dependency builds were already prepared by the author. They were not repeated because root/package/new-test configured typechecks and all unit suites passed with the prepared declarations. This validator does not claim a fresh independent emit/build result; publisher build/full gates remain required. No generated asset is selected for publication.

### Preserved failed attempts and limits

- The first independent Vitest execution passed all 59 tests. Formatting changed only the validator's new test, followed by passing scoped format, lint, types, and test gates.
- Two validator-only driver setup mistakes are retained in `grammar-evidence.json#/toolingAttempts`: an incorrectly quoted newline in the extraction command, and use of single-statement `parse` for multi-statement programs. The latter is explicitly superseded by correct `parseModule` baseline/current evidence, not reported as a repository regression or silently counted as RED.
- All genuine baseline failures, complete current/replay outputs, and author evidence remain preserved. The frozen author parser, tests, plan, manifest, and TREE tokenizer/parser-test anchors remain byte-identical to the input candidate.
- No source arity assertion or NUM-001 repair is included. No promise of full ECMAScript grammar, new accessor/generator support, zero existing skips, or current publication is made.

### Immutable candidate and publisher contract

Freeze six exact publishable payloads: the four unchanged author publishables plus this independent report and `packages/safejs/src/parse/keyword-methods-validation.test.ts`. Production remains parser-only. The validator's `out/safejs-remediation/ip-002-validation/hash-manifest.json` records repo-relative/captured paths, SHA-256/bytes, roles, report SHA, validated-byte equality, author-manifest identity, and base/current-integration preimages. Read-only candidate copies reside under `candidate/`; pristine tracked preimages are captured separately under `preimages/`, while new-file absence is explicit.

The publisher must consume captured bytes, verify the current target files against the recorded preimages (or recorded absence), and rerun fresh full gates before serial release. Later shared/live-file changes cannot substitute for this candidate. The final verification record checks captured=validated bytes, immutable author identity, original input preservation, exact file inventory, and read-only payload/preimage/manifest modes. No staging, commits, pushes, pulls, branches, other-clone writes, README edits, or production edits were performed.
