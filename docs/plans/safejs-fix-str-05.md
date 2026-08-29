# STR-05 functional split remediation

## Scope and ownership

- Author workspace: `/Users/kjopek/Workspace/poe-code-safejs-split-captures`, isolated main clone from the publish clone's origin. No branches, commits, pushes, original-workspace writes, README additions, or inline comments.
- Pulled first with `git pull --ff-only origin main`; base `33c73a21fb01875b0e2297ccac955974a0889991` already includes STR-03 replacement fixes. Preserve upstream changes.
- Only production target: `packages/safejs/src/interp/methods/string.ts`. Regression tests belong beside it; this plan is the only planning document.
- User requirement: optional unmatched split captures remain own `undefined` elements, distinct from empty strings and holes. Upstream already preserves this distinction; the original STR-05 reduction instead exposes a spurious terminal capture. Fix split assembly only, not regex execution or replacement semantics.

## Read boundary

- Before any original audit payload, read `out/safejs-audit-2026-08-27/inventory-verification.json` and establish its 38 `archiveReadPolicy.excludedPaths`, plus the entire `security/` subtree. Also respect the recorded outside-cohort blocked directory.
- Metadata bootstrap allowlist: `out/safejs-audit-2026-08-27/inventory.json`. It identifies the active functional STR-05 source and recorded source hash.
- Initial functional payload allowlist: `out/safejs-audit-2026-08-27/strings/reductions/r07-zero-width-split.safejs` only. Any expansion requires explicit nonexcluded functional identification before bytes are read.
- No archive recursive scans, excluded reads/hashes/execution, security research, LLM calls, or guest I/O. Original source remains unchanged and read-only.

## Execution and validation

1. Record base, policy, exact preimages, and original functional source hash in ignored `out/safejs-remediation/str-05/`.
2. Install with `SKIP_SYNC_SKILLS=1 npm ci`; build required workspace dependencies.
3. Add fast in-memory direct-method and interpreter tests before production edits. Compare native arrays with strict equality, own-slot checks, and explicit undefined-versus-empty assertions. Cover optional, nested, multiple, empty and present captures; integer limits; empty inputs; zero-width boundaries; supported flags and lastIndex preservation.
4. Run failing tests and unchanged original source against native before applying the minimal split-only root fix via `apply_patch`.
5. Run focused, broader, and full configured tests with `env -u TERM`; configured type checks, lint, and scoped formatting. Preserve every failed attempt and qualify unrelated STR-01/02/03/04 and regex-key-order behavior rather than broadening this patch.
6. Freeze exact candidate, test, plan, preimages, original-source comparison evidence, logs, and SHA-256 manifest. Independent validation and publication belong to the coordinator, not this author.

## Initial observations and limits

- Initial shell inspection failed because a zsh loop used special variable `path`, changing command lookup; a subsequent explicit Node path also failed. Both attempts occurred before any original payload read. Retain this history in the evidence record.
- The metadata bootstrap was printed too broadly on the first read; subsequent metadata inspection was restricted to STR-05 records. No excluded artifact bytes were read.
- No visual CLI behavior changes are intended; screenshot checks are not applicable to this internal array-semantics patch. No end-to-end provider or LLM execution is permitted.
- First red run: 11 failed / 31 passed. Ten failures expose split boundaries; one was a test comparison artifact (native realm object versus SafeJS null-prototype object). Structured cloning both return objects normalizes prototypes while retaining own undefined slots and holes; no JSON projection is used for assertions.
- Original unchanged reduction baseline: native captured array `["a", "b", ""]`; SafeJS `["a", "b", "", undefined]`. Its fourth slot is own undefined, not empty, null, or a hole. All four neighboring fields match. Source SHA-256 `9ec3190d87f38c9087ee5fd5610420319153e1d86b3a90bfe476f35396e7def1` agrees with inherited metadata.
- Direct baseline optional unmatched and matched-empty controls already pass, so their current distinction must remain untouched.
- One exploratory lookup used nonexistent `regex/parser.ts`; the actual file is `regex/parse.ts`. No original archive read was involved.
- Corrected red run: 13 failed / 36 passed (49 tests), including supported flag and limit controls. `red-test.ts` freezes that exact test revision. First green run: 49 passed.
- Minimal fix skips zero-width matches at the previous split endpoint or the input end, then appends the correct tail for nonempty input. Existing capture allocation remains unchanged, so legitimate unmatched groups remain own undefined slots and matched-empty groups remain empty strings.
- Broader method/regex run: 324 tests across 10 files passed. Full build completed 67 workspace tasks and root bundling. Both wrapper commands then hit zsh's read-only `status` variable; complete successful tool logs remain, and subsequent wrappers use `command_status`.
- Formatting initially warned for the new test and production file; the test was formatted with `apply_patch`, and the added condition's continuation was corrected. A preliminary `format-baseline.json` reason incorrectly suspected inherited formatting debt; its boolean evidence actually says the baseline is formatted. This is a superseded interpretation, not an upstream defect.

## Original functional controls

- Expanded the explicit allowlist before reading payloads, using inventory entries marked active-functional. Exact paths are frozen in `functional-allowlist.json`; all ten are nonexcluded string examples/reductions. No additional artifact-directory scan occurred.
- Six of ten unchanged original inputs match native exactly: the substantial marked-table workflow, both STR-03 replacement reductions, STR-05, Unicode/anchor controls, and repeated-capture controls.
- STR-05 matches all five original fields. Its captured array has exactly three own entries, ending in an empty string; there is no fourth own undefined entry.
- STR-01 remains in the replacement/Unicode workflow as exactly five missing token offsets: `/0/tokens/0/offset`, `/0/tokens/1/offset`, `/1/tokens/0/offset`, `/1/tokens/1/offset`, `/1/tokens/2/offset`. All other return fields, including split pieces and replacement results, match native.
- The metadata reduction retains STR-01 missing `index`/`input` values and separate regex match-array key ordering (`groups,index,input` instead of `index,input,groups`). No metadata fix is attempted.
- STR-02 still returns an empty array rather than null for an unmatched global match. STR-04 still ignores initial global lastIndex in matchAll and preserves lastIndex after match/replace instead of resetting it. These are separate defects, not STR-05 regression failures.
- STR-03 is already fixed at the pulled base and remains passing. No replacements, regex engine/parser/state, metadata, limits coercion, or key-order changes are included.
- Original outputs are saved as readable inspection, tagged-undefined JSON, and lossless V8 serialization. Strict array assertions, not JSON equality, establish STR-05 parity and slot identity.
- Tested flags are empty, `g`, `i`, `m`, `s`, and `gims`; Unicode mode (`u`) and sticky (`y`) are unsupported in the current parser and are not newly promised. UTF-16 splitting without Unicode mode is covered. Limits cover omitted/undefined and nonnegative integer truncation; general ToUint32 coercion remains out of scope.
- The test's embedded STR-05 template was parsed with the TypeScript AST and confirmed byte-identical to the original source, including its trailing newline. This is not a rewritten reproduction.
- SafeJS full configured suite: 147 passed files / 1 skipped; 4,216 passed tests / 39 skipped; 27.19 seconds. The new tests are in-memory and perform no filesystem writes. Existing configured repository suites are run as supplied; no excluded original security artifact is used.
- Root configured type check, SafeJS configured type check, and explicit strict type check of the new test all pass. Root ESLint and scoped ESLint pass. Both the base production file and final production file pass Prettier; the new test and canonical plan pass too. `git diff --check` passes.
- Build-generated terminal-pilot fonts and remediation evidence are locally ignored through `.git/info/exclude`; no tracked ignore/config changes or font candidates are proposed.
- Full repository configured `env -u TERM ... npm test` passes: 937 passed files / 3 skipped; 21,601 passed tests / 41 skipped; 268.86 seconds. Turbo reports one successful root test task, with no cache hit. No test failure or timeout remains.
- Workflow lint also passes; no workflow changes or workflow unit tests were added.
- Final exact-byte full rerun, forced after all production/test formatting: 937 passed files / 3 skipped; 21,601 passed tests / 41 skipped; 198.79 seconds, exit 0, no cache hit. `final-test-inputs.json` records the unchanged source/test hashes used by this run.
- Final build succeeds with 67 workspace tasks and root bundling, exit 0. The built public SafeJS core API independently passes the unchanged STR-05 source and explicit own-undefined-versus-empty controls.
- Final configured `npm run lint` succeeds in full, including root ESLint, configured root types, and workflow lint, exit 0.
- Status: ready for separate independent functional validation of the frozen exact candidate. Independent validator acceptance, commit, push, and publication are not claimed or performed.

## Reproduction commands

Run from the isolated clone. Test environment removes `TERM`; snapshot playback is forced and cache misses fail, avoiding live LLM calls.

```sh
SKIP_SYNC_SKILLS=1 npm ci
SKIP_SYNC_SKILLS=1 npm run build
env -u TERM node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-split.test.ts --reporter=verbose
env -u TERM node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex --reporter=verbose
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit --workspace=@poe-code/safejs
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm test
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/turbo run test:unit --concurrency=1 --force --
npm run lint
npm run lint:types
node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/safejs/src/interp/methods/string-split.test.ts
npm run lint:eslint
npm run lint:workflows
node_modules/.bin/eslint packages/safejs/src/interp/methods/string.ts packages/safejs/src/interp/methods/string-split.test.ts
node_modules/.bin/prettier --check packages/safejs/src/interp/methods/string.ts packages/safejs/src/interp/methods/string-split.test.ts docs/plans/safejs-fix-str-05.md
git diff --check
```

Original functional replay is an agent-executed step, not a committed QA script: establish exclusions and the explicit functional allowlist first; read only those sources; independently execute unchanged source in native `node:vm` and SafeJS `run` without bindings; normalize object prototypes using structured cloning; compare arrays strictly and assert own-slot identity. For STR-05 expect exactly three captured entries `["a", "b", ""]`, all five fields matching native. For optional unmatched controls assert an own undefined slot and explicitly reject an empty string. Preserve complete return values with V8 serialization and readable inspection, not JSON alone.

## Freeze contract

- Canonical owned paths: `packages/safejs/src/interp/methods/string.ts`, `packages/safejs/src/interp/methods/string-split.test.ts`, and this plan. The production diff is six added lines and two removed lines in split assembly only.
- Freeze exact copies under ignored `out/safejs-remediation/str-05/candidate/`, plus the existing production preimage and absence records for the new test/plan. Freeze a combined patch without staging files.
- Include all red/green/check/build logs, initial tool failures, the corrected prototype-comparison failure, the corrected formatting interpretation, source allowlists, native/SafeJS typed evidence, and SHA-256 entries. Do not hide earlier failures behind successful reruns.
- The manifest must name every frozen artifact explicitly, distinguish the pulled base and final candidate, and give the canonical candidate hashes. The external manifest SHA-256 is reported in the handoff, avoiding a self-referential manifest hash.
- Ready means ready for separate independent functional validation of this exact candidate only. It does not mean full ECMAScript regex parity, resolution of unrelated STR defects, security approval, or release approval. Original audit security and all 38 excluded paths remain untouched.

## Ordered integration author proof — August 29, 2026

This appended section records a new integration delivery; all preceding author history and the separate validator report remain historical and unchanged.

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-split-captures-integrated`, a new main clone from the publisher origin. Pull ran first and selected base `3180c4c3a1f3d125d1b2916357438e9167694fa6`. All earlier clones, captures, reports, and original audit inputs are read-only. No commits, pushes, new branches, README changes, or inline comments.
- Before original payload reads, establish the 38 exclusions from the policy bootstrap and block the entire security subtree and recorded outside-cohort directory. Original payloads are restricted to ten explicitly allowlisted active-functional string sources, with no recursive audit scans, excluded reads/hashes/execution, security research, live LLM calls, or guest I/O.
- Approved manifest SHA-256 values: STR04 `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f`; metadata order `fdc814b784fe91260513833d081f61af3297dbf616ae1b994926089d2f7052e3`; STR02 `e7e9b68fa086dcd0a9428e75c91ff4cf3b2c356f9a2b80af7d13c262e0a29583`; STR05 `a87ddee6928bc8074bec855c5e26402cff6120a289bafcc328edb3ab557791a6`. All listed publishables and application preimages are individually verified.
- Order: STR04 six, metadata six, STR02 six, then STR05 five. All six STR04 files already match upstream exactly, so its separate delta is empty rather than reapplying or reverting anything. Metadata and STR02 apply as separate clean three-way deltas. Record their preimages/postimages and the exact post-STR02 application preimages.
- Only the five approved STR05 paths belong to this final delivery. Copy the two approved test files and validator report byte-for-byte; append this integration proof only to the author fix plan. Merge production changes against the old STR05 preimage and the current post-STR02 file; never overwrite the current String implementation with an old whole-file capture.
- TDD: with prerequisites only, execute all 49 unchanged author and 813 unchanged independent STR05 tests and retain failures. Then apply the minimal STR05 boundary fix and require all 862 to pass. Run the prior 1,842 prerequisite string controls unchanged. Re-execute all seven historical qualification assertions unchanged; all seven must pass, with no expected-failure weakening.
- Independently rerun the ten full unchanged original sources against native and SafeJS with complete typed outputs. Require all ten to match and explicitly prove STR05's five fields and own undefined versus holes, empty strings, and null. Preserve STR03 substitution tokens, STR04 cursor behavior, metadata key order, and STR02 null semantics. Do not expand unsupported flags or general limit coercion.
- Run fast in-memory tests, broader and full suites with TERM unset, full build, configured root/package/new-test types, configured lint, and formatting over all publishables. Preserve every failure and correction. Freeze only the STR05 delta as the publication patch, with separate prerequisite deltas and exact hashes under ignored `out/safejs-remediation/str-05-integration/`.
- Initial inspection printed approved manifest metadata more broadly than necessary; subsequent inspection uses selected fields. No original excluded artifact was opened. No execution failure has occurred at this checkpoint.
- Status: prerequisite staging complete; prerequisite-only STR05 red proof pending. A fresh combined independent review is still required after this author handoff.

### Combined integration results

- Prerequisite-only STR05 red: 199 failed / 663 passed, 862 total. The unchanged author suite is 13 failed / 36 passed (49); the unchanged independent suite is 186 failed / 627 passed (813). All failures are retained in the red JSON and text logs.
- The seven historical qualification assertions are unchanged, including their historical suite title. Before STR05 they are six passed / one failed; after STR05 all seven pass. No assertion is weakened, skipped, inverted, or marked as an expected failure.
- The clean production three-way merge changes only the two split-boundary conditions: six added lines / two removed lines. An AST-based byte comparison proves all 23 other top-level statements are identical to post-STR02, including STR03 replacements, STR04 cursor collection, and STR02 no-match handling. The STR04 splitter clone and existing undefined-capture allocation remain intact.
- Combined STR05 green: all 49 author tests and 813 independent tests pass, 862 total. The prior six-file, 1,842-test prerequisite cohort passes both before and after STR05. The expanded 39-file broader cohort passes all 4,074 tests.
- Full unchanged original replay transitions from nine exact native matches and the isolated STR05 mismatch to ten of ten complete typed native matches. Native results are recomputed independently and match the prior native values. All five STR05 fields match, including exactly three captured elements with no fourth own slot. Additional typed proofs distinguish own undefined captures from holes, null, and empty strings, including lossless V8 round trips. No payload fields are omitted from the recorded outputs.
- All 18 approved test/report/prerequisite-plan files retain their approved SHA-256 hashes. Both STR05 test files and its validator report are untouched. The original STR05 author fix plan remains an exact prefix of this file; only this integration section is appended. The unchanged qualification test hash is `47be6e73beea96e49f411a2c5e305b53ba140eb38d58c9aace61e4e2c2ca75fc`.
- Full build passes 67 workspace tasks and root bundling with TERM unset. Configured root lint (ESLint, root types, workflow lint), package types, and a configuration extending the package tsconfig with all eight approved test files as explicit roots pass. All 21 unique prerequisite/final publishable paths pass formatting.
- Current remaining checks: full SafeJS and full repository runs, final freeze verification. Fresh combined independent review is not performed by this integration author.

### Integration replay and handoff

Use the ignored `out/safejs-remediation/str-05-integration/` evidence directory only for captures, logs, configs, and manifests, not as a publication tree. The STR05 publication patch contains only its five approved paths relative to the exact post-STR02 state. Prerequisite patches and their pre/post images are separate; STR04 is recorded as already present in upstream rather than included again.

```sh
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-split.test.ts packages/safejs/src/interp/methods/string-split.independent.test.ts
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/vitest run --config out/safejs-remediation/str-05-integration/qualifications.config.ts
env -u TERM SKIP_SYNC_SKILLS=1 npm run build
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm run test:unit --workspace=@poe-code/safejs
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error npm test
env -u TERM npm run lint
env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM node_modules/.bin/tsc -p out/safejs-remediation/str-05-integration/test-types.tsconfig.json --noEmit
```

The exact unchanged prior-cohort and expanded-broader file lists are recorded in their command JSON captures. Recheck every source-manifest hash, frozen candidate hash, and actual target preimage before future publication. Full original comparisons use the explicit allowlist and in-memory native/SafeJS execution; they are agent-executed proof steps, not a new QA script or a change to validator tests.

### Final integration gates and scope

- Full SafeJS: 171 passed files / one skipped; 7,472 passed tests / 39 skipped; exit 0. Full repository: 961 passed files / three skipped; 24,857 passed tests / 41 skipped; exit 0, no cache hit, 263.63 seconds. Production and approved test bytes are unchanged throughout the final green, build, lint/types, and full-suite runs.
- The built public core API also reproduces all ten complete original return values exactly against native. No remaining historical qualification failure exists in this combined candidate; historical report wording remains untouched rather than being retroactively rewritten.
- Prerequisite delta export initially labeled new files as empty named preimages; exports now explicitly use `/dev/null` for additions. Initial exports are retained. This is an evidence-export correction, not a runtime/code/test change. Replay validation uses a separate ignored temporary Git index against the pulled base; the working index, main HEAD, other clones, and approved captures remain unchanged.
- Publication scope is exactly `packages/safejs/src/interp/methods/string.ts`, `packages/safejs/src/interp/methods/string-split.test.ts`, `docs/plans/safejs-fix-str-05.md`, `packages/safejs/src/interp/methods/string-split.independent.test.ts`, and `docs/plans/safejs-validate-str-05.md`. The STR05 patch is relative to post-STR02, not a blanket diff from main, and does not republish metadata or cursor prerequisites.
- All expected red failures, original prerequisite-only output differences, approved reports, initial export artifacts, and final green evidence are retained. The initial policy's inherited zero-read fields are not this task's functional-read census: this task reads only the ten named functional originals, with zero excluded-artifact reads/hashes/executions and no original or older-clone writes.
- Unsupported flags and general limit coercion remain outside this fix. No security approval, release authorization, or fresh independent combined approval is claimed. The handoff is ready for a separate fresh combined functional review after final manifest verification. No commits, pushes, or feature branches are created.
