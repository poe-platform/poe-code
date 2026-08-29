# Independent STR-04 merged validation

## Decision and isolation — August 29, 2026

**Scoped ready for this exact STR04 + STR03 + ARRAYOWN candidate.** This is a fresh independent validation, not a revision of the earlier blocked candidate's verdict or a certification of future combinations.

- Delegated validator works directly for the root orchestrator, only in `/Users/kjopek/Workspace/poe-code-safejs-regex-cursor-integrated`.
- Frozen base: `7fec2826bac2933483c2579ff47d2264f8e1f422`. Local history includes the ARRAYOWN commit and preceding STR03 work. The assignment supplies the released ARRAY 11.0.9 context; no external CI/release status is independently certified here.
- Author manifest: `out/safejs-remediation/str-04-integration/candidate-7fec2826-str04/manifest.json`; verified SHA-256 `486470e5357d3c4e64a7b00b477e448a0faf75c9f60a719ac861edb32d76ae33`.
- Applicable workspace-parent and clone-root AGENTS were read; no deeper package/docs AGENTS apply.
- No production, test, historical-report, Git configuration/ref, or other-clone edits. No commits, pushes, branches, pulls, or intentional Git-mutating commands. The index-file qualification below is retained explicitly. The only new publishable is this report, added with `apply_patch`.
- Evidence is under the already-ignored `out/safejs-remediation/str-04-integration/independent-validation/`; no ignore configuration changes were needed.

## Exact merge and preservation

Verified all five author publishables against working and immutable copies, the current production preimage against Git, seven unchanged references, and every author evidence hash. Reproduced `git merge-file --diff3 -p` from the author's exact current/ancestor/incoming evidence inputs, without writing a production file or modifying Git state.

| Merge input                                                     | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Ancestor `a962264d3ec5f40c91f4e1a1bc15f3148fff3091` `string.ts` | `0dd53f36441b5b3edbccb5b25115b74d036e22c254313449d55871d7f4664d84` |
| Current `7fec2826` `string.ts` preimage                         | `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b` |
| Incoming STR04 `string.ts`                                      | `1501078eb9ddba91c703659a801b21202e9c050352b82666102c8786566c29a3` |
| Recomputed merge and candidate `string.ts`                      | `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67` |

The merge exits **0, with zero conflicts**, and its bytes equal the candidate. AST comparison identifies only four changed functions: `replaceRegex`, `callSplit`, `callMatchLikeMethod`, and `collectRegexMatches`, plus their import adjustments. The STR03 `expandReplacement` helper is byte-identical to the current base, and replacement-token dispatch remains present. The other **44 upstream paths** between the incoming ancestor and current base remain byte-identical to current Git preimages; the complete intervening change set is those 44 paths plus `string.ts`.

The split change creates a private cursor-bearing regex; it does not implement STR05 capture repair. No ARRAY accessor patch is transplanted, and no metadata-order, STR02, parser/engine, or unsupported-flag changes are included. `regex.ts` remains at SHA-256 `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1`.

Both cursor test files and the historical validator report are byte-identical to their historical manifest and read-only prior-clone files:

| Preserved path                                                        | SHA-256                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/regex-cursor.test.ts`             | `cc5dad2313bd152615e255b72b8064a72c77f142cd3d055f84b1ad0ee20e8f19` |
| `packages/safejs/src/interp/methods/regex-cursor.independent.test.ts` | `c8e459902a8550eb373eed6f69893f140986135ca336227d690bee13548b2d82` |
| `docs/plans/safejs-validate-str-04.md`                                | `11ddae5118af033434a4b5f66d19bf502b2f14dae1ec8269d1506ed809519b72` |

The original author plan remains an exact byte prefix of the integrated author plan. Its historical statements and the prior validator's blocked verdict remain intact, followed by the author's integration appendix and this separate fresh report.

## Guarded original workflow

Before any original payload read, bootstrapped `inventory-verification.json` metadata, installed its exact **38 exclusions**, and denied the entire original `security/` directory. The exclusion-list SHA-256 is `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13` using `JSON.stringify` in metadata order.

Only `out/safejs-audit-2026-08-27/strings/reductions/r05-global-lastindex.safejs` was allowlisted/read/copied. Exact membership, deny checks, directory boundary, and realpath were checked before reading. Source SHA-256: `ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d`. The independent test's source literal is byte-identical, including the trailing newline, verified through the TypeScript AST. No recursive audit scans, excluded reads/hashes/execution, original writes, security research, guest I/O, or LLM calls occurred.

Executed the exact source natively first in a VM with a 1500 ms timeout, then twice through actual `packages/safejs/src/run.ts`, each with a 5,000-step budget. Both complete returned values strictly equal native; both report `nodeVisits: 49`. No original source adaptation or output projection was used.

```json
{
  "all": ["a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 0,
  "replaced": "XbX",
  "afterReplace": 0
}
```

This preserves the native sequence: assign cursor 2, matchAll leaves 2, match resets 0, assign 2, replace resets 0. `original-full-output.json` retains the full source, native output, both actual outputs, and stats. The same original full-result assertion also passes unchanged in the 1,027-case independent suite.

## Independent RED, GREEN, and historical failures

For fresh RED, a Vite pre-load hook supplies only the exact `7fec2826` `string.ts` Git blob; the remainder of the ARRAYOWN + STR03 tree and both test files stay unchanged. GREEN uses current package source without the hook. Production is never reverted or edited.

| Suite                       | Current-base RED        | Merged GREEN   |
| --------------------------- | ----------------------- | -------------- |
| Unchanged author tests      | 103 fail / 309 pass     | 412 pass       |
| Unchanged independent tests | 373 fail / 654 pass     | 1,027 pass     |
| Combined                    | **476 fail / 963 pass** | **1,439 pass** |

All 1,439 test identities and statuses exactly reproduce the author's RED/GREEN captures. There are no duplicate identities, skips, todos, or assertion edits. The original independent tests continue to use strict typed full-result comparisons; no JSON conversion, metadata removal, projection, or relaxed expectation was added to make them pass. Coverage remains the original 960 operation/flag/pattern/cursor cases, 48 failed-scan continuations, 16 callback cases, two unsupported-sticky-flag rejection checks, and exact original case. Supported `g,i,m,s` behavior is tested without expanding accepted flags.

Copied the prior **118-failure** result JSON and log read-only into new evidence after verifying their historical hashes. Historical result SHA-256: `36b69b41c43bdb1654058d524c54031d46990609ff21b47f5d88fb7d4094eb72`. All 1,027 historical identities remain present. All **118 previously failing full-result cases now pass**: 76 already pass on the current ARRAYOWN base, while 42 still require the STR04 cursor merge. `assertion-identity-proof.json` records each exact identity and all three statuses. The historical failures and old blocked verdict are retained, not erased or recast as earlier passes.

## Regression and configured gates

All Vitest runs use `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error`, with logs and JSON results. Tests resolve actual package source, use bounded pure workflows or existing stubs/memfs, and make no real LLM requests.

| Gate                                                           | Independent result                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Focused unchanged cursor suites                                | 1,439 pass / 2 files                                                       |
| Exact author broader scope                                     | 2,773 pass / 31 files                                                      |
| Additional published MC-001 suites                             | 36 pass / 2 files                                                          |
| Unique broader coverage, without double-counting focused tests | **2,809 pass / 33 files**                                                  |
| `env -u TERM npm run build`                                    | Exit 0; 67/67 workspace tasks, root generation/compilation/bundle complete |
| Explicit cursor-test TypeScript config                         | Exit 0; both test roots included                                           |
| SafeJS source and configured root TypeScript                   | Exit 0 for both                                                            |
| Repository ESLint                                              | Exit 0                                                                     |
| Package lint                                                   | Exit 0; 17/17 rules, 68 packages                                           |
| Prettier on all six publishables, including all three plans    | Exit 0                                                                     |
| `git diff --check`                                             | Exit 0                                                                     |

Broader coverage includes **161 STR03**, **136 COLL001**, **40 OBJ001**, **79 MC003**, **36 MC001**, **12 ARRAYOWN**, **15 call-order**, and **477 interpreter** tests, plus the relevant methods, regex engine/parser, globals, metadata, Markdown offsets, and contextual-import tests. These counts are subsets, not extra tests to add to 2,809. No whole-SafeJS or whole-repository test pass is claimed. Configured source/root type checks exclude tests; the explicit test config independently includes the two cursor files, not every historical test fixture in the repository.

Reproduction commands, from the new clone:

1. Focused: `./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-cursor.test.ts packages/safejs/src/interp/methods/regex-cursor.independent.test.ts`. RED adds `--config out/safejs-remediation/str-04-integration/independent-validation/baseline.config.ts`.
2. Broader: `./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/run.call-order.test.ts packages/safejs/src/metadata-validation.test.ts packages/safejs/src/loader/markdown-offset-hi-002.test.ts packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts`.
3. Additional MC-001: `./node_modules/.bin/vitest run packages/safejs/src/lint/known-globals-mc-001.test.ts packages/safejs/src/lint/known-globals-mc-001-validation.test.ts`.
4. After workspace declarations are built: `./node_modules/.bin/tsc -p out/safejs-remediation/str-04-integration/independent-validation/tsconfig.tests.json --noEmit`; `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`; `env -u TERM npm run lint:types`.
5. Lint: `env -u TERM npm run lint:eslint`; `env -u TERM npm run lint:packages`. Formatting checks explicitly list the six publishables rather than scanning audit evidence.

## Freeze and publication boundary

The immutable independent candidate is `out/safejs-remediation/str-04-integration/independent-validation/candidate-7fec2826-independent/`. Publish exactly the author's five paths plus this new report. Capture exact bytes, current-base preimages, validation-entry preimages, historical/new evidence, and a SHA-256 manifest; freeze copies read-only with `uchg`, leaving working copies unsealed. At current base only `string.ts` exists; the other five publishables have explicit absent base preimages. At validation entry the author's five paths exist unchanged; this report is new. All six final publishables and all three plans pass formatting.

Exclude the entire ignored evidence tree and pre-existing terminal-pilot font assets from publication. No production/test changes or prior-clone writes were made by this validator. Git HEAD, configuration, and local exclusions are byte-unchanged.

Operational qualification: the strict byte-identity check on `.git/index` failed after the gates. All **3,739 stage-zero entries still exactly match HEAD**, and the staged diff is empty; the change is consistent with an index metadata/cache refresh, but its cause was not independently established. No index restoration was attempted. `git-state-qualification.json` preserves both hashes and the entry comparison. This qualifies the requested no-Git-mutation boundary: no staged-content or ref changes occurred, but this report does not falsely claim an unchanged index file. Functional scoped readiness is unaffected.

**Pending:** regex metadata own-key order, STR02 global-match no-match null, and STR05 split captures are not included or certified. No global string parity, general descriptor parity, unsupported flag expansion, or complete remediation claim is made. The publisher must compare the actual publication preimage, compose any later fixes with a three-way merge, and obtain fresh independent merged validation plus full publication gates. This report does not pre-certify those future combinations.
