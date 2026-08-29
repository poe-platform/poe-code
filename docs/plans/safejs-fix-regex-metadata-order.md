# Regex match metadata own-key order

## Assignment and isolation

- Delegated author-fix worker, operating directly without nested delegation.
- Owned clone: `/Users/kjopek/Workspace/poe-code-safejs-regex-metadata-order`.
- Origin obtained read-only from the publisher: `git@github.com:poe-platform/poe-code.git`.
- New single-branch `main` clone; first repository operation after clone was successful `git -c pull.rebase=false pull --ff-only` (`Already up to date.`).
- Base: `ecfd838abd37fb061d66dc8721bc3f86067139ad`; initial status clean.
- Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and clone-root `AGENTS.md`. No deeper package/docs instructions found.
- Existing STR-04 clone and its captures remain read-only and are not reused as this candidate. No STR-04 edits, commits, pushes, new branches, stashes, resets, README edits, inline code comments, or other-clone writes.

## Functional observation and dependency boundary

The supplied integrated ARRAY+STR03 capture contains ten original workflows: nine have complete native parity; `r01-match-metadata.safejs` has exactly nine differing key-array leaves, three per exec/match/matchAll result. Native keys are `["0","1","index","input","groups"]`; integrated actual keys are `["0","1","groups","index","input"]`. All other fields in that captured case agree.

This fresh base includes STR03 but not ARRAYOWN. A native-first current-source run reproduces fifteen full-output differences: the nine ordering leaves plus six named reads (`index` and `input` on each result) returning the string `"undefined"`. This issue repairs only creation order. Do not duplicate ARRAYOWN's accessor repair or claim full original-workflow parity on this base. STR04 full validation's reported 118 metadata-index failures remain a separate dependency observation, not a result of this candidate.

## Read-only evidence and exclusions

- Before any original audit payload read, loaded only `inventory-verification.json` metadata and installed its exact 38 exclusions plus the entire `security/` directory in a deny-first, explicit-allowlist reader.
- Exclusion-list SHA-256 (`JSON.stringify` in metadata order): `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.
- Only original payload allowlisted/read: `strings/reductions/r01-match-metadata.safejs`; SHA-256 `0d5bef1aede138e38a3f8d8367a61f601dc451b0167c2d15590d230009b8f2ce`.
- Supplied functional capture: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata-integrated/out/safejs-remediation/array-own-integrated-validation/candidate-20260829-arrayown-integrated-noether/evidence/original-full-expected-actual.json`; SHA-256 `fa4eff44caffc79f863b043bf93b1f38c408d3827517d2d746ab63cbb11627c9`.
- Supplied validator report: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata-integrated/docs/plans/safejs-validate-array-own-metadata.md`.
- No recursive audit/family search, excluded reads/hashes/execution, or security research. Supplied captures and every other clone remain unchanged.

## Setup

Followed the pinned setup report in `/Users/kjopek/Workspace/poe-code-safejs-fixes/out/safejs-remediation/setup/report.md`:

- Node `v22.22.2`, npm `10.9.7`.
- `SKIP_SYNC_SKILLS=1 npm ci`: exit 0; 548 packages, 619 audited. Existing install report has 10 vulnerabilities; no dependency edits or audit fix.
- Explicit builds for `@poe-code/agent-spawn`, `@poe-code/frontmatter`, and `tiny-mcp-client`: exit 0, 21/21 tasks, 11.165 seconds.
- Local-only `.git/info/exclude` ignores `/out/safejs-remediation/regex-metadata-order/`. No tracked ignore configuration changed.

## TDD plan

1. Establish bounded native original output before any current-source run.
2. Add failing native-anchored creation-order and supported-reflection tests.
3. Change the shared match-array creation order only.
4. Verify keys, values, undefined presence, own capture indices, and array length through exec/match/matchAll; preserve non-match/global-match controls.
5. Run focused/broader tests, configured source and new-test types, lint, formatting, and build gates with `TERM` removed for full terminal-sensitive gates.
6. Freeze exact publishables, base preimages, evidence, and hash manifest for separate independent validation. No publication or overall remediation completion.

## Initial preimages

| Path                                                              | SHA-256 at base                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/regex.ts`                     | `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1` |
| `packages/safejs/src/interp/methods/regex-metadata-order.test.ts` | absent                                                             |
| `docs/plans/safejs-fix-regex-metadata-order.md`                   | absent                                                             |

Unchanged reference `string.ts`: `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b`. Root manifest: `a3e5638abe5f1df44298e105db2a25c93ad6d0d26ef1d8ab2f93cfa466f11b99`. Lock: `297af2f85db1eeedaca7a33f64a4ec95bed39754d42a1e787a236c4af55c29c7`.

## Root fix and actual TDD

The only production change is one line in `toMatchArray`:

```ts
Object.assign(result, { index: match.index, input, groups: undefined });
```

Previously `groups` was inserted before `index` and `input`. Numeric captures are still created first; the same three metadata properties and values are then assigned, in native insertion order. All callers already share this construction helper, so exec, non-global match, and matchAll are fixed together without API-specific patches. No accessor, regex engine, parser, flags, cursor, or descriptor implementation changes are made.

Native anchors were evaluated before current TypeScript. The focused suite tests five bounded patterns (no captures, one capture, an unmatched optional capture, eleven captures, and a zero-width result), each through supported `Object.keys`, `Object.values`, `Object.entries`, and `Object.hasOwn` reflection on all three APIs. Direct creation tests also verify own undefined captures, groups presence, actual metadata values, numeric index presence, and array length. The no-match and global-match-collection controls remain unchanged.

Command: `env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-metadata-order.test.ts --reporter=verbose`.

- **RED:** exit 1; **21 failed, 2 passed, 23 total**. Duration 820 ms, test time 114 ms. Log `red.log`.
- **GREEN:** exit 0; **23 passed**. Duration 786 ms, test time 79 ms. Log `green.log`.
- Test imports resolve current TypeScript, not SafeJS dist. Tests do not create files, use guest modules, or call an LLM. No filesystem fixture is needed.

## Original full output evidence

The exact unchanged original was evaluated natively in a bounded VM first, then through `packages/safejs/src/run.ts` using `node --import tsx`. Both post-fix runs return identical complete values and stats (`nodeVisits: 79`). Native VM timeout is 1500 ms and current-source child timeout is 10000 ms; guest modules are empty. Source and exact executed command are retained in `original-full-expected-actual.json`.

Native expected (also identical to the supplied integrated capture's expected value):

```json
[
  {
    "text": "ab",
    "capture": "b",
    "index": "2",
    "input": "🧪ab",
    "keys": ["0", "1", "index", "input", "groups"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "2",
    "input": "🧪ab",
    "keys": ["0", "1", "index", "input", "groups"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "2",
    "input": "🧪ab",
    "keys": ["0", "1", "index", "input", "groups"]
  }
]
```

Current base before this fix:

```json
[
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "groups", "index", "input"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "groups", "index", "input"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "groups", "index", "input"]
  }
]
```

Current source after this fix, both runs:

```json
[
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "index", "input", "groups"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "index", "input", "groups"]
  },
  {
    "text": "ab",
    "capture": "b",
    "index": "undefined",
    "input": "undefined",
    "keys": ["0", "1", "index", "input", "groups"]
  }
]
```

| Comparison                              | Key-order differences | Other differing leaves | Whole-workflow parity |
| --------------------------------------- | --------------------- | ---------------------- | --------------------- |
| Supplied ARRAY+STR03 integrated capture | 9                     | 0                      | No                    |
| Fresh base before this fix              | 9                     | 6 named reads          | No                    |
| Fresh base plus this fix                | **0**                 | **6 named reads**      | **Not claimed**       |

The remaining paths are `$[0].index`, `$[0].input`, `$[1].index`, `$[1].input`, `$[2].index`, and `$[2].input`. The key-only original regression intentionally does not assert that these pending accessor values match. Supported reflection and direct helper tests prove the stored metadata values are retained. The other nine workflows in the supplied ten-case capture are inherited evidence only; they were not rerun or recertified here. This candidate has not been integrated with unpublished ARRAYOWN or STR04 bytes.

## Validation results

All commands ran in the owned clone on August 29, 2026. Full terminal-sensitive gates use `env -u TERM`.

| Command                                                                                                                                                                                                                                 | Actual result                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Focused Vitest command above                                                                                                                                                                                                            | 23/23 GREEN after actual 21-failure RED                                                                               |
| `env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/globals/misc.test.ts --reporter=dot` | Exit 0; **12 files, 322 tests**, 2.19 s total, 374 ms tests                                                           |
| `env -u TERM ./node_modules/.bin/tsc -p out/safejs-remediation/regex-metadata-order/tsconfig.tests.json`                                                                                                                                | Exit 0; explicitly includes the new test and extends root configured strict options; effective configuration captured |
| `env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`                                                                                                                                                         | Exit 0                                                                                                                |
| `env -u TERM npm run lint:types`                                                                                                                                                                                                        | Exit 0, root configured types                                                                                         |
| `env -u TERM npm run lint:eslint`                                                                                                                                                                                                       | Exit 0, full repository ESLint                                                                                        |
| `env -u TERM npm run build`                                                                                                                                                                                                             | Exit 0; **67/67** Turbo tasks, 29.83 s Turbo phase; schema generation, root compilation, and bundle succeeded         |
| `env -u TERM npm run lint:packages`                                                                                                                                                                                                     | Exit 0; **17/17 rules**, 68 packages, including built-artifact checks                                                 |

Prettier checks cover all three publishable files; `git diff --check` verifies the production diff. Formatting changes use `apply_patch`. No workflow edits, full repository test run, slow/fuzz/adversarial job, novel resource/security probe, or global install is performed. No CLI presentation code changed, so screenshot validation is inapplicable.

## Freeze and exact publishables

The ignored evidence root is `out/safejs-remediation/regex-metadata-order/`. The immutable handoff candidate directory is `candidate-ecfd838a-regex-metadata-order/` beneath it. Publishable/preimage/evidence copies are verified by SHA-256 and sealed read-only. `manifest.json` contains exact paths, byte counts, base Git blobs, base/preimage hashes, final hashes, and evidence hashes; its digest is external in `manifest.sha256` to avoid self-hashing.

Only these paths are publishable:

| Path                                                              | Base/preimage SHA-256                                              | Final SHA-256                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/regex.ts`                     | `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1` | `514b2a48bcfe9ffa6eccd2ae4deb23eb2c87aceb2c5083b6fdf621708ea2cd39` |
| `packages/safejs/src/interp/methods/regex-metadata-order.test.ts` | absent                                                             | `c86d58b72cf48f048c60dbd579d23d8fb8e92c7219cab87080f00c4a4455e2e3` |
| `docs/plans/safejs-fix-regex-metadata-order.md`                   | absent                                                             | Recorded externally in the frozen manifest                         |

The original input source, supplied integrated evidence and report are read-only inputs, not publishables. The old STR04 clone/captures are not modified. Working-tree root manifest/lock and `string.ts` are checked unchanged against the base. No late pull or claim about current remote HEAD is made.

## Risks and required follow-up

- Independent validation is still required; this is an author candidate, not publication approval.
- Integrate ARRAYOWN separately before certifying original named metadata reads. Then rerun the unchanged original full workflow and confirm zero remaining differences. Do not treat this candidate's passing key projection as full original parity.
- STR04 remains a separate cursor candidate. This patch changes only match-array property insertion order; `executeRegex`, lastIndex transitions, and string operations are byte-unchanged here.
- No support is added for sticky/Unicode flags, named groups, unsupported regex syntax, or general property-descriptor parity.
- Full build generated four untracked `packages/terminal-pilot/assets/jetbrains-mono-{400,700}-{italic,normal}.ttf` copies. They are not publishables and were not manually edited/removed. Never stage broad directories.
- Logs, the focused test-type configuration, frozen copies, and `.git/info/exclude` are local-only evidence/setup, not issue patch paths.
- No commits, pushes, releases, overall-goal completion, or other-clone writes occurred.

## Ordered integration proof — August 29, 2026

This appendix records a new author integration, not a revision of the historical author or independent validator findings above. The historical ARRAY named-read and STR04 integration qualifications are resolved only for the exact cases rerun here. Fresh Gödel validation of these combined bytes is still required; nothing is committed, pushed, or approved for publication by this appendix.

### Base, prerequisites, and publication boundary

Owned clone: `/Users/kjopek/Workspace/poe-code-safejs-regex-metadata-order-integrated`. Cloned publisher origin `git@github.com:poe-platform/poe-code.git` with `--single-branch --branch main`, then successfully ran `git -c pull.rebase=false pull --ff-only` before repository work. Base is `f5dc9facc00e03fd2ade2af650b25bda7dc43068`; it contains published ARRAYOWN `7fec2826bac2933483c2579ff47d2264f8e1f422` but not STR04. Ancestor/root instructions were read. All other clones and captures remain read-only.

The approved STR04 input is `/Users/kjopek/Workspace/poe-code-safejs-regex-cursor-integrated/out/safejs-remediation/str-04-integration/independent-validation/candidate-7fec2826-independent/manifest.json`, SHA-256 `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f`. Its six files are a prerequisite only:

- `packages/safejs/src/interp/methods/string.ts`
- `packages/safejs/src/interp/methods/regex-cursor.test.ts`
- `packages/safejs/src/interp/methods/regex-cursor.independent.test.ts`
- `docs/plans/safejs-fix-str-04.md`
- `docs/plans/safejs-validate-str-04.md`
- `docs/plans/safejs-validate-str-04-merged.md`

STR04 must publish first. Do not include any of those six files in the metadata-order commit. No Git index staging was performed: the prerequisite was applied to the isolated working tree.

The order input is `/Users/kjopek/Workspace/poe-code-safejs-regex-metadata-order/out/safejs-remediation/regex-metadata-order-validation/candidate-ecfd838a-independent/manifest.json`, SHA-256 `6b30cd6106707a962221ec1a07025cb62dcd545efa4779609ab42e657b8acf12`. The metadata-order publication delta contains exactly five paths:

- `packages/safejs/src/interp/methods/regex.ts`
- `packages/safejs/src/interp/methods/regex-metadata-order.test.ts`
- `packages/safejs/src/interp/methods/regex-metadata-order.independent.test.ts`
- `docs/plans/safejs-fix-regex-metadata-order.md`
- `docs/plans/safejs-validate-regex-metadata-order.md`

The two sets are disjoint. All prerequisite bytes, all four test files/assertions, and all three validator reports remain byte-identical to the approved captures. Only this own fix plan receives an append-only integration record; its original prefix SHA-256 remains `4ca9028233c3def33cdcd726ab5f7e97241e3fa05842b4af04e9bdae103ad638`.

### Three-way application and preimages

Both production merges used actual `git merge-file --diff3 -p` with separately captured ancestor/current/incoming bytes, followed by `apply_patch`: STR04 ancestor `7fec2826`, order ancestor `ecfd838a`. Both exited 0 with zero conflicts and zero manual semantic resolutions. Each merged production file equals its approved incoming file. No old whole-file overwrite was used to discard upstream changes.

STR04's current-main `string.ts` preimage is `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b`; prerequisite result is `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67`. Its other five paths are absent on this main base. The metadata delta's current post-STR04 `regex.ts` preimage is `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1`; result is `514b2a48bcfe9ffa6eccd2ae4deb23eb2c87aceb2c5083b6fdf621708ea2cd39`. Its other four paths are absent in the logical post-prerequisite tree. That tree is base plus the six approved files, not a fabricated commit identifier.

The order production delta remains one line in `toMatchArray`: creation assigns `index`, `input`, then the present-but-undefined `groups` property. It does not modify cursor state, replacement tokens, array accessors, captures, numeric indices, or property values. The published STR03 `expandReplacement` helper is unchanged (SHA-256 `2ab9492d56ba958e4af4f76ed12d3635afbe147e744aec9df800a8d75edb9cf7`). The other 46 upstream paths changed since the original pre-STR03 author base remain byte-identical to current main; ARRAY/OBJ/MC/TREE/HI and subsequent collection fixes are preserved.

### Actual current-source RED and GREEN

Native anchors ran before original SafeJS workflows. The focused command used current TypeScript, not dist, and the four unchanged cursor/order test files under `packages/safejs/src/interp/methods`, with `env -u TERM ./node_modules/.bin/vitest run` plus dot/JSON reporters. Full identities and results are recorded in the evidence.

| Stage                                                           | Order author         | Order independent      | STR04 author | STR04 independent | Total                             |
| --------------------------------------------------------------- | -------------------- | ---------------------- | ------------ | ----------------- | --------------------------------- |
| Current main plus approved STR04, before order production delta | 21 failed / 2 passed | 129 failed / 40 passed | 412 passed   | 1,027 passed      | 150 failed / 1,481 passed; exit 1 |
| Combined prerequisite plus one-line order delta                 | 23 passed            | 169 passed             | 412 passed   | 1,027 passed      | 1,631 passed; exit 0              |

RED took 1.84 s (1.58 s tests); GREEN took 1.91 s (1.54 s tests). All 1,439 cursor assertions remain GREEN, including the unchanged prior metadata dependency assertions. No validator edits, weakened expectations, skips, TODOs, new regex features, or STR02/STR05 changes were needed.

### Full original outputs, not key projections

Before original payload reads, the read guard bootstrapped exactly 38 exclusions from `inventory-verification.json` (SHA-256 `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`), denied the whole `security/` directory, and admitted only eight explicit nonexcluded functional source paths. There were no recursive audit/family searches or excluded reads/hashes/executes. Source hashes and the exact allowlist are in `audit-read-policy.json` and `original-full-comparison.json`.

All ten captured workflows were rerun without source adaptations: semver sorting, Unicode template replacement, mustache scanning, regex metadata, semver overlap, histogram, numeric array metadata, and the records/duplicate-ids/empty-left LCS cases. Fresh native outputs match the captured anchors. Current-source full values were compared before and after the order delta, then repeated after it. All ten combined full outputs match native twice, with identical repeated values and step statistics. This certifies this exact cohort, not unrelated workflows or overall remediation.

| Full regex metadata stage                             | Ordering differences | Named-read differences | Total differences |
| ----------------------------------------------------- | -------------------- | ---------------------- | ----------------- |
| Historical original author capture before ARRAY/order | 9                    | 6                      | 15                |
| Fresh current base plus STR04 prerequisite only       | 9                    | 0                      | 9                 |
| Fresh combined candidate, both runs                   | 0                    | 0                      | 0                 |

The six named reads were fixed by ARRAY already on main, not by this order patch. They are the `index` and `input` fields in each exec/match/matchAll result. Each fresh full native and combined record is `{"text":"ab","capture":"b","index":"2","input":"🧪ab","keys":["0","1","index","input","groups"]}`. The prerequisite-only records already have correct values but keys `["0","1","groups","index","input"]`, producing exactly nine differing key positions. The complete native, prerequisite-only, historical, and both combined outputs are retained, including all differing leaf paths; no field projection or output normalization hides differences.

The guarded functional runners use the captured bounded inputs/limits, no guest filesystem, no LLM, no security/resource probes, and in-memory source execution. Host-side evidence capture is not guest IO. Tests are pure unit tests; no QA executable files were added.

### Integrated gates and frozen queue

All terminal-sensitive commands used `env -u TERM`. Setup used `SKIP_SYNC_SKILLS=1 npm ci` plus the pinned dependency builds (21/21). The install's existing vulnerability notice was not investigated or changed.

| Gate                                                                                                                           | Actual result                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Four-file focused tests                                                                                                        | RED 150 failures, then GREEN 1,631/1,631                                          |
| Published/relevant broader methods, regex, globals, interpreter, ARRAY metadata, call-order, MC/HI contextual and loader tests | 33 files, 2,965 tests passed; 6.86 s total, 5.01 s tests                          |
| Explicit four-new-test configured TypeScript check                                                                             | Exit 0; extends configured strict options; effective config captured              |
| Root `npm run lint:types` and SafeJS `tsc --noEmit`                                                                            | Exit 0 each                                                                       |
| Full `npm run lint:eslint`                                                                                                     | Exit 0                                                                            |
| Full `npm run build`                                                                                                           | Exit 0; 67/67 tasks, 25.432 s Turbo phase; schema generation and bundle completed |
| `npm run lint:packages`                                                                                                        | Exit 0; all 17 rules passed                                                       |
| Prettier checks and `git diff --check`                                                                                         | Recorded in final frozen gate evidence                                            |

Evidence root is `out/safejs-remediation/regex-order-integration/`, ignored locally. The frozen queue is `candidate-f5dc9fac-ordered/` beneath that root: `prerequisite/manifest.json` holds only the six STR04 files and current-main preimages; `order-delta/manifest.json` holds only the five order paths and current post-STR04 preimages. The top-level `manifest.json` references both separately and records full evidence hashes. Manifests and SHA-256 sidecars are outside the issue commit. Exact final hashes, including this appended plan, live there to avoid a self-referential document hash.

Fresh independent merged validation must check those exact frozen bytes and preserve publication order. If main advances or the actual published STR04 bytes differ, revalidate against the new post-STR04 preimages rather than bundling or overwriting prerequisite files. STR02 no-match-null and STR05 undefined split captures remain separate unpublished issues. No general descriptor parity, unsupported flags, or regex features are introduced. Build-generated terminal font copies are excluded, not deleted. No README, master plan, validator report, old clone, commit, push, or release was changed by this integration.
