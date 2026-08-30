# R3 independent diagnosis: qualified agreement, no repair/release authorization

2026-08-28, America/Chicago. Source/data only. Criteria were sealed before reading
the diagnosis bodies, after authoring and with earlier reviews known. No subject
module import, product/native/test/private/build/probe or cleanup was performed.

## Immutable authority and verification

- Diagnosis: `cd9d08be0918ddc5bd59c40b088e06be2b5b2f54`.
- R3: `c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5`; consumed authorization
  `021302a101371e7984e2244853f4f5e9f2c9778c`. One attempt, coordinator1/HOLD.
- Packet: `69f5cc1b05484c9d0836edf77bfbbbfb46145383`; shipping source
  `f03c260269dfd8ee10666f7fd2560655f8e14a38`, all41 files authenticated against
  Git, actual40 DRIVER members and accepted e5ed3ecb metadata bindings.
- Product: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; expected package
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`, not repacked.
- Driver: `aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424`.
- Effective qualification: `fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510`.
- OS-fence module: `1955d2225312f57dfd4f7cb4a122e4d940caf997aea9ba4aa4c85f85558bac69`;
  this attempt's rendered profile: `3eb15d23270dc16e6257cd6f783b8118d2d5b7975e9c699311eac833593a9170`.
  These are different from the effective qualification hash, not new OS attestations.
- Historical receipt `519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6`
  remains exactly two unsupported FILE observations, never a directory/signal waiver.

All928 encoded/gzip/raw capture hashes and retained regular-file bytes match:
923 inner +5 outer,114,734,734 raw bytes. This includes6 stdout files,6 stderr
files and901 ndjson logs; these are file categories, not test/stream-chunk counts.
Decoder reads64KiB chunks with64MiB/file,128MiB total-raw and32MiB compressed
declared caps. No archive or instruction payload was materialized.57 diagnosed
candidate source files match mode/blob/size/SHA. All632 canonical argv members and
archive/post-setup baseline body hashes match f5 and the accepted e5ed body proof;
Git blob identities independently agree. No live overlay, fresh632 run or pack.

`BINDINGS.json` links928 captures and57 source records; `CROSSWALK.json` gives139
ordered rows with exact Unicode names, original IDs, LF line/byte offsets,
parent/indent/ordinal, diagnostic digest, source hashes and independent reason.
`ASSESSMENT.json` records exact group members, compiler and guard bindings;
`FILESYSTEM.json` lists every286 entry and71 input-compatible root grouping.

## Counts and phase boundaries

Raw footer and independent result parsing agree: **19,425 PASS /132 FAIL /7 SKIP**,
zero cancelled/TODO.19,564 test records =19,337 top-level +227 nested; suites0.
The139 nonpassing rows match the original and author indexes one-to-one with no
duplicates, missing rows, group overlap or deductions. No child reporter summary
is added to this denominator. A single aggregate test remains one TAP failure.

Six phases started/closed: safejs-availability0, cold-typecheck78,
typecheck-all0, **benchmark-types1**, env-source-binding0, canonical1. Eight later
phases, including current-consumers, pack/public and final-sweep, did not run.
“Benchmark never ran” must mean **the compiler/checker never executed**, NOT that
phase4 was unlaunched. Canonical row.accounting exists and matches raw TAP;
execute.mjs:115's top-level report.canonical assignment was not reached because
the phase's post-run source guard threw before returning.

## Independent failure taxonomy (all remain FAIL)

| Group | Rows | Established observation / limitation |
|---|---:|---|
| G01 |4| Explicit /usr/bin/git EPERM; selector is denied. Attempted path known, kernel denial layer not traced. |
| G02 |68| GNU patch /tmp/pp* creation denied:34 auxiliary,18 native-controls,2 overlap,12 envelopes,2 safety. Some product calls ran; oracle equivalence unqualified. |
| G03 |5| Apple alternate patch --version fails /tmp/patcho* before replay, not five GNU product failures. |
| G04 |6| StructuralSignal rejected by AbortSignal.any before checkpoint; structural/branded contract boundary unresolved, not proved real-Shell reason regression. |
| G05 |2| Initial DIRECTORY mode wrapper fails; underlying chmod/identity/mode-check cause absent in TAP. |
| G06 |1| 384-transition aggregate contains32 distinct directory mismatch rows, native1 versus virtual0/mode differences.32 is not32 independent failures; native stderr/cause absent. |
| G07 |2| Frozen Node22.22.2 prerequisite rejects24.11.1 before its semantic checks. |
| G08 |5| Bash pipeline cannot find cut/sort/tee/xargs/cat in finite inherited routes. |
| G09 |2| Child summaries report10/10 and6/6 but wrappers demand TAP # pass; no wrapper rescore. |
| G10 |1| Native tac stderrHex decodes /var/tmp/cutmp* denial; one aggregate observation-array failure. |
| G11 |1| listen EINVAL on110-byte socket path before FS assertions. Length is plausible, not established syscall cause. |
| G12 |1| Nested verifier replaces PATH and bare git rev-parse fails EPERM; resolved executable is not recorded. |
| G13 |1| Bare npm ENOENT before positional TAP check. |
| G14 |1| Strict-header loop126 conflicts with source env -S support returning0. Header attribution is source-derived, not individually labelled in raw error. |
| G15 |32| Native cwd snapshot contains sh-thd-* with TMPDIR=cwd. Both native and virtual ran; earlier status checks reached, later product file checks unreached. Bash temp-retention cause remains unknown. |

Requested rollups independently confirm73 patch/temp,32 shell/temp,5 Git,
7 search PATH/reporter =117 distinct rows. The other15 are retained explicitly,
not inferred away. No ordinary supported-input product defect is conclusively
isolated by these records; **this is not product exoneration**.

Seven SKIPs:2 Python +1 tiny-xxd PATH access discovery;1 cksum declared discovery
exhausted (source swallows only ENOENT);1 xxd probe converts ANY spawn error into
skip;2 opt-in GNU/BSD replay flags disabled. No machine-wide absence claim, no
parity credit.51 native identity assets are not semantic eligibility or complete
canonical route coverage. No Python/xxd/cksum admission is manufactured.

## Source mechanisms and minimal owner handoffs

Paths in this section are pinned to f5 unless prefixed launcher-v3 (f03).

1. **Fixture scratch and guard pollution.**
   `tests/commands/table-text-stress/corpus.test.ts:27` invokes71 native fixtures;
   `support.ts:52–64` creates/validates but never removes each .native-* directory.
   Each observed directory has left/right/sentinel:71 directories +213 files =284
   entries (3,664 file bytes). Exact sentinel/input hashes match; duplicate input
   pairs do not identify unique calls/PIDs. The Node fixture creates these paths,
   not proof that native executables created the parent/files.
   `shared-stdin-fix/support.ts:49` creates .runtime; :77 removes children only.
   `tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts:37`
   creates .runs; context.after owns its child only. Both parents are empty.
   Total **73 directories +213 files +0 symlinks =286**, not273 or289.
   Every entry is absent from captured post-setup baseline and present in the
   guard's exact added-path error/current readonly metadata. No whole retained
   tree/private scan. Ownership/callsite inference is strong; no syscall/PID trace.
   Owner repair: versioned isolated scratch placement plus awaited try/finally
   cleanup after snapshots/diagnostics, owning parent lifecycle across child work.
   Do not broadly ignore .runtime/.runs or waive append-proof guards. No cleanup
   of this attempt's preserved roots is authorized.
2. **Native temporary namespaces.**
   `gnu-auxiliary/helpers.ts:101`, `gnu-target-followup/helpers.ts:60`,
   `formats/helpers.ts:61`, `gnu-target/oracle.ts:37` and
   `tests/commands/stream-inspection/oracle.ts:27` use fixed child environments.
   Missing TMPDIR discards the launcher's owned tmp policy. /tmp/pp, /tmp/patcho,
   /var/tmp/cutmp lie outside the fence's allowed write subtrees; denial is policy-
   consistent, not exclusive kernel-cause proof. Version exact child env and
   admitted owned scratch without permission widening or native identity changes.
   `tests/shell-stress/helpers.ts:39,74–99` instead sets TMPDIR=cwd then snapshots
   cwd: separate native scratch from semantic files and retain scratch diagnostics;
   never delete/filter arbitrary sh-thd names from comparison as a success fix.
3. **Explicit tool/reporter routes.**
   `editflows/helpers.ts:50` explicitly requests /usr/bin/git;
   `tests/integration/s3-http-exports/verify.mjs:19,43,62` overrides PATH then requests
   bare git with rev-parse --verify HEAD^{commit}. Neither is the already-repaired
   prerequisite/privateState adapter scope. Use a new bound fixture route to the
   admitted Git/core/environment, not ambient PATH, xcodebuild or outside-fence
   execution. `search-stress/harness.ts:25,64` inherits the finite native/tool
   PATH; missing pipeline tools need exact closure/role admission before use.
   `qualified-current-release-native-data/helpers.ts:26` bare npm needs an explicit
   admitted npm CLI route. Search safety/streaming wrappers:7 need explicit TAP
   before positional paths, preserving status and exact counts, not relaxed regexes.
4. **Benchmark is an actual infrastructure failure.**
   `launcher-v3/execute.mjs:112` selects benchmarks/node_modules/typescript/bin/tsc.
   `build-audit.mjs:8` realpath fails ENOENT before entry execution. Benchmark lock,
   manifest and authenticated dependency inventory contain zero TypeScript entries;
   no missing projection is established. Root lock/compiler is5.9.3 and admitted:
   bin/tsc SHA `8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`;
   implementation hash is in ASSESSMENT.json. Minimal maintained-driver proposal:
   explicit root compiler, benchmark cwd, unchanged --noEmit -p tsconfig.json.
   Preserve build audit, lock/source/dependency binding and one production-build
   accounting. No npx/install/network/ambient resolution; no predicted type pass.
5. **Unresolved product/contract/profile boundaries.**
   `expr/inactive-prefix.test.ts:179–204` supplies StructuralSignal;
   `src/commands/regex-execution/client.ts:270–271` brands via AbortSignal.any before
   `src/commands/expr/index.ts:16` callback. Contract owner must decide faithful
   supported signal fixture versus product change; never swallow TypeError or
   lose reason identity, especially undefined's AbortController default behavior.
   `permission-profile/fixtures.ts:52–70` wraps directory setup errors; retain
   underlying cause in a versioned diagnostic, not a new FILE waiver. G06's32
   mismatches remain one observed differential. `darwin-profile.test.ts:15–19`
   is explicitly Node22/libuv-pinned, not a Node24 qualification.
   `tests/fs/real/adversarial.test.ts:220–233` puts listen before close-finally;
   future fixture owner can register cleanup before acquisition and use a short
   controlled owned pathname. EINVAL does not justify FS behavior/permission changes.
   `script-entrypoint/cases.ts:131–136` versus `src/shell/runtime.ts:1392–1407`
   demonstrates the env-S expectation conflict; any maintained fixture revision
   must retain the other invalid-header/UTF8 controls and receive explicit authority.

## Finite prospective verification conditions — not GO

Freeze exact successor files/tools/argv/env/fence and raw holdout IDs before any
future authorized run. No general native rerun, skip/deduction or old-body rewrite.
Suggested bounded initial packets, only after separate owner/ROOT authority:
- Compiler route:3 controls (exact route/entry identity, absent-or-wrong entry
  rejected before dispatch, noEmit benchmark routing does not add production build).
- Scratch: one historical holdout +one in-root positive +one pre-dispatch wrong
  tmp rejection per changed callsite, at most5 callsites/15 controls initially;
  shell snapshot separation2 families with ordinary extra-file sensitivity (4).
- Cleanup:3 creation origins, each success and throwing-path ownership/settlement
  proof (6); raw evidence before teardown, no retained-root deletion.
- Routes:2 Git callsites +5 pipeline commands +1 npm route, at most16 paired
  positive/wrong-route controls; new tool identity gaps require explicit binding,
  not an allowance. Reporter2 wrappers each positive TAP/wrong-format negative (4).
- G04/G05/G06/G07/G11/G14: source/contract/profile disposition first; then exact
  named holdouts only under separately scoped GO. No new denied setid admission
  probes, real socket operation, signal experiment or product patch is requested here.

## Closure and qualification

Recorded R3 setup completed nine stages including privateBefore/copy/privateAfter;
264 private files copied then and captured outer comparison unchanged, zero
recorded changed files. Reviewer inspected NO private contents or live state.
Captured copy admission records zero instruction entries; exact5 candidate +1
dependency metadata omissions remain bound, not universal no-copy assurance.
Post-canonical verifyAll fails in source guard BEFORE later extra/private-copy
guards, so no final copy-integrity sweep is inferred. Outer finally did record
private comparison; no privateGuardError field appears. These are recorded scope,
not freshly checked private cleanliness or completed final guards.

All six phase receipts and outer child record closed/clean, null signals, no
reported survivors, no phase timeout; this does NOT qualify aggregate cleanup:
bindingComplete/guardsPassed/cleanupComplete remain false, fenceClean false,
final-sweep unexecuted. No reviewer signals, cleanup or retained-root mutation.
Both prior consumed0/14 failures, E03.3 unsupported, H06 conditional source
qualification, H11 cohorts and original unknown EPERM target remain historical.

Metadata-only query mistakes (missing source filename and JSON container-shape
assumptions) are retained in the data receipt; neither diagnosis parser/cohort
ran subject code. Original132+7/928 files remain unchanged. Root owns all future
repair/profile decisions and fresh packet/release. This assessment issues none.
