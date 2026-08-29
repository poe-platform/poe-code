# Independent ordered regex metadata validation

## Decision — August 29, 2026

**Scoped ready in the required order: approved STR04 prerequisite, then metadata-only delta.** All ten selected original workflows now match complete native outputs twice. This is not publication authorization, a prediction about future main, or global string parity.

- Delegated independent validator, working directly for the root orchestrator only in `/Users/kjopek/Workspace/poe-code-safejs-regex-metadata-order-integrated`.
- Frozen base: `f5dc9facc00e03fd2ade2af650b25bda7dc43068`, containing ARRAYOWN and the collection test-typing repair, but not the queued STR04 files.
- Author queue manifest: `out/safejs-remediation/regex-order-integration/candidate-f5dc9fac-ordered/manifest.json`; verified SHA-256 `132c3b18aecf29720fcf5e2451b05d36f224f27087e0ff5e3a5a67574db30405`.
- Read applicable workspace-parent and clone-root AGENTS; no deeper package/docs AGENTS apply.
- No production/test/historical-report edits, other-clone writes, staging, commits, pushes, branches, pulls, or publication actions. This report is the only new publishable. Original-workflow checks and configuration are ignored evidence, not issue files.
- Existing local exclusion already covers the evidence directory. Gate subprocesses inherit `GIT_OPTIONAL_LOCKS=0`; HEAD, configuration, and exclusions are byte-unchanged. The staged diff remains empty. A later index-file qualification is recorded below rather than claiming full-run index byte immutability.

## Ordered captures and preimages

Verified the top manifest, both queue manifests, every author evidence hash, all eleven working/frozen incoming files, and the exact approved captures in read-only prior clones.

| Queue item                         | Verified manifest SHA-256                                          | Scope                                                 |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Approved STR04 capture             | `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f` | Six prerequisite files, unchanged                     |
| Current-base prerequisite snapshot | `d4bc50352b15e9f94cfd9ddb49ecb6f475b4f1631ca775dbe50838f25a937fd2` | STR04 current-base preimages and exact incoming bytes |
| Prior independent metadata capture | `6b30cd6106707a962221ec1a07025cb62dcd545efa4779609ab42e657b8acf12` | Metadata source/tests/report ancestry                 |
| Author metadata-only delta         | `7acf0c91cef71aaa67738d6dc4b8449a473834cf98f10ff5b9460b81fffc94ee` | Five metadata paths, disjoint from prerequisites      |

The six STR04 prerequisite files are `string.ts`, the two cursor tests, and the three STR04 fix/validation plans. Every byte matches the approved prerequisite capture. They must not be included in the metadata commit or republished by this validator.

The metadata delta consists of `regex.ts`, the two metadata-order tests, and the metadata fix/validation plans; this new integrated validation report is its sixth publishable. All incoming assertions and validator reports remain byte-identical. The metadata author's fix plan has only its verified append-only integration record; its historical prefix is unchanged.

| Production path and publication stage                          | Required preimage SHA-256                                          | Exact resulting SHA-256                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| STR04 first: `packages/safejs/src/interp/methods/string.ts`    | `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b` | `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67` |
| Metadata second: `packages/safejs/src/interp/methods/regex.ts` | `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1` | `514b2a48bcfe9ffa6eccd2ae4deb23eb2c87aceb2c5083b6fdf621708ea2cd39` |

Both production three-way merges were independently recomputed with `git merge-file --diff3 -p` from captured ancestor/current/incoming bytes. Both exit **0 with zero conflicts** and reproduce the working files exactly. The metadata production delta is precisely one creation-order line: `groups, index, input` becomes `index, input, groups`. No property value, capture index, descriptor implementation, cursor logic, parser, or flag support is changed by that delta.

The STR03 replacement expansion helper and token dispatch remain intact. The other **46 upstream paths** changed since the original pre-STR03 ancestor remain byte-identical to the current base, including ARRAY properties/accessors and COLL typing. STR04 production and all 1,439 cursor test identities are preserved. The metadata preimage is unchanged by the disjoint STR04 prerequisite; the logical post-prerequisite state is recorded, not represented as an invented Git commit or assumed future main.

## Original audit guard

Before any original payload read, bootstrapped only `inventory-verification.json` metadata, installed its exact **38 excluded paths**, and denied the entire `out/safejs-audit-2026-08-27/security/` directory. Exclusion-list SHA-256, using `JSON.stringify` in metadata order: `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.

The explicit payload allowlist contains only these eight source paths within that audit:

- `strings/examples/04-semver-coerce-sort.safejs`
- `strings/examples/06-template-replacement-unicode.safejs`
- `strings/examples/07-mustache-scanner-offset.safejs`
- `strings/reductions/r01-match-metadata.safejs`
- `strings/reductions/r02-semver-overlap-progress.safejs`
- `numerics/09-histogram-object-configuration.ajs`
- `numerics/13-array-metadata-reduction.ajs`
- `data-pipelines/lcs-array-diff.ajs`

For each read, checked exact allowlist membership, exclusions, directory boundary, and realpath before accessing payload bytes. Copies and hashes match the captured originals exactly. No recursive audit/family scan, excluded read/hash/execution, original write, security research, real LLM request, or guest I/O occurred. The LCS source runs with its original `records`, `duplicate-ids`, and `empty-left` bindings; eight files therefore yield ten workflows.

## Full original outputs and retained failures

All ten sources and original bindings were verified byte-identical to the captured inputs. Native execution precedes current-source execution. Body scripts use a bounded native VM; the two unchanged default-export modules use native data-URL module loading. The native complete values match the earlier anchors and are retained in a **typed V8 serialization**, not only JSON.

For each workflow, current `run` uses the untouched original source, empty guest modules, original bindings, and the original default entry point where applicable. The two actual full return values each pass strict comparison against the typed native value and against each other, including deterministic stats and step counts. Structured cloning normalizes host object prototypes only; it retains own undefined values and holes. Tagged JSON is an evidence rendering, not the parity oracle. No field projection, source adaptation, or weaker expected value was introduced.

Guest limits remain bounded: 150,000 steps for the string/numeric workflows and 300,000 for LCS, with 2.5/3-second deadlines and bounded depth/data/string/array limits. Tests read only staged host fixtures and do not create files or expose I/O to guests.

| Original cohort                                                                 | STR04 + ARRAY prerequisite only | Ordered metadata candidate |
| ------------------------------------------------------------------------------- | ------------------------------- | -------------------------- |
| Semver sorting/coercion, Unicode replacement, mustache scanning, semver overlap | Full native match               | Full native match twice    |
| Histogram configuration and numeric array metadata                              | Full native match               | Full native match twice    |
| LCS records, duplicate IDs, empty left                                          | Full native match               | Full native match twice    |
| Regex metadata full workflow                                                    | Nine differing key-order leaves | Full native match twice    |

The complete historical outputs and failed logs are retained with verified hashes. The unchanged old three-test original assertion file was copied byte-for-byte and rerun: **2 fail / 1 pass** on prerequisite-only state, then **3 pass** with metadata ordering. Combined with the ten new original evidence checks: **3 fail / 10 pass → 13 pass**. Its previously failing full native assertion is now genuinely green, not skipped, rewritten, or marked expected-failure.

| Regex metadata state                        | Key-order differences | Named-read differences | Total |
| ------------------------------------------- | --------------------- | ---------------------- | ----- |
| Historical before ARRAY and ordering        | 9                     | 6                      | 15    |
| Historical metadata candidate without ARRAY | 0                     | 6                      | 6     |
| Current ARRAY + STR04 prerequisite only     | 9                     | 0                      | 9     |
| Current ordered metadata candidate          | 0                     | 0                      | 0     |

ARRAY supplies the previously missing `index` and `input` named reads. The metadata delta supplies only the ordering repair. Each final exec/match/matchAll record is `{"text":"ab","capture":"b","index":"2","input":"🧪ab","keys":["0","1","index","input","groups"]}`. `full-original-and-assertion-proof.json` retains complete historical, prerequisite-only, expected, and both final outputs, including differing leaves. Prior blocked/qualified reports remain unchanged.

## RED, GREEN, and regression gates

Fresh prerequisite-only RED loads exactly the current-base `regex.ts` preimage through a Vite pre-load hook, leaving all six STR04 files active. No production file is reverted. GREEN removes that hook. The four package test files are unchanged and all 1,631 identities/statuses match the author's fresh captures.

| Suite                       | Prerequisite-only RED     | Final GREEN    |
| --------------------------- | ------------------------- | -------------- |
| Metadata author tests       | 21 fail / 2 pass          | 23 pass        |
| Metadata independent tests  | 129 fail / 40 pass        | 169 pass       |
| Both unchanged STR04 suites | 1,439 pass                | 1,439 pass     |
| Combined focused            | **150 fail / 1,481 pass** | **1,631 pass** |

Metadata coverage retains exact numeric/enumerable/full own-key ordering, own undefined versus holes and empty captures, all supported `g,i,m,s` combinations for the relevant APIs, and global/no-match controls. All **118 historical STR04 full-result failures** remain preserved as historical evidence and again pass by exact identity. No assertion or unsupported-flag boundary was changed.

| Additional gate                                                                | Result                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Exact author broader scope                                                     | **2,965 pass / 33 files**                                                   |
| Additional MC-001 suites                                                       | **36 pass / 2 files**                                                       |
| Unique broader runtime coverage, focused tests already included                | **3,001 pass / 35 files**                                                   |
| Original full-output evidence checks                                           | **13 pass**, covering ten workflows twice and the unchanged historical file |
| `env -u TERM npm run build`                                                    | Exit 0; **67/67 tasks**, root generation/compile/bundle complete            |
| Explicit test TypeScript configuration                                         | Exit 0; seven explicit test roots                                           |
| SafeJS source/root configured types                                            | Exit 0 for both                                                             |
| Repository ESLint                                                              | Exit 0                                                                      |
| Package lint                                                                   | Exit 0; **17/17 rules**, 68 packages                                        |
| Prettier on all twelve prerequisite/metadata publishables, including six plans | Exit 0                                                                      |
| `git diff --check`                                                             | Exit 0                                                                      |

The explicit type roots include all four cursor/order files, the repaired COLL001 validation fixture, the new original-cohort evidence test, and the unchanged historical original test. This avoids claiming test type coverage from source/root configurations that exclude tests. Existing STR03/ARRAY/COLL/OBJ/MC regressions remain in the broader scope. No full SafeJS or repository-wide test pass is claimed.

Evidence root: `out/safejs-remediation/regex-order-integration/independent-validation/`. Vitest runs use `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error` and retain logs plus JSON results. Focused runs explicitly name the four package tests; RED adds `--config` pointing to `prerequisite-only.config.ts`. Original runs use `originals-prerequisite.config.ts` and `originals.config.ts`. The broader command matches the author's 33-file scope; the MC-001 command names the two `known-globals-mc-001` test files separately. Build precedes `tsc -p` checks for `tsconfig.tests.json`, `packages/safejs/tsconfig.json`, and `npm run lint:types`. Lint uses `npm run lint:eslint` and `npm run lint:packages`.

## Metadata-only freeze and publisher boundary

Freeze under `out/safejs-remediation/regex-order-integration/independent-validation/candidate-f5dc9fac-metadata-only/`. Its top-level publishables contain **only six metadata paths**: the author's five delta files and this report. The six prerequisite files are separate reference captures with their own current-base preimages and approved manifest; they are not metadata publishables. Preserve metadata post-prerequisite preimages, validation-entry copies, exact original/historical/new evidence, and the immutable manifest. Copies are read-only with `uchg`; working files remain unsealed.

The publisher must first publish or verify the exact approved STR04 prerequisite, then compare actual post-STR04 preimages before applying metadata-only paths. Any change in main or prerequisite bytes requires fresh preimage checks, merge validation, and publication gates. Never combine both path sets into one issue commit or treat this report as publication authorization. No future combined state is already certified.

Operational qualification: all monitored Git files, including the index, were byte-unchanged at the post-gate checkpoint. A later pre-freeze index hash check failed despite `GIT_OPTIONAL_LOCKS=0`; all stage-zero entries still exactly match HEAD, the staged diff is empty, and HEAD/configuration/exclusions remain unchanged. The cause was not independently established. No Git-mutating command or index restoration was performed. Both checkpoints and hashes are retained in `git-state-verification.json` and `git-state-late-qualification.json`. This qualifies the requested no-Git-mutation boundary without changing the functional scoped verdict.

**Still pending:** STR02 global-match no-match null and STR05 split captures are not included, fixed, or certified. These ten passing original workflows do not establish all-string, general descriptor, or unsupported-regex-feature parity. Build-generated fonts and every ignored evidence artifact remain outside publication. All earlier clones, captures, failure evidence, and reports remain unchanged.
