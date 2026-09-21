# Repeated hidden goal seek QA

Use only the authenticated Gnumeric 1.12.61 archive in out (SHA-256
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12).
Reference dependency/plugin/locale profile: docs/ssconvert/statistics-native-profile.json.
Native is a separate QA oracle, never a product capability or fallback.

Source contract: test/t7000-goal-seek.pl (not t7100, which is solver blending),
src/dialogs/dialog-goal-seek.c test mode, src/tools/goal-seek.c and ssconvert.c.
Five horizontal cells are formula, changing input, target, minimum, maximum.
Blank bounds mean +/-1e24. Values use raw numeric coercion, not dialog entry
format matching. There is no separate result cell; failed input is #VALUE!.
Ranges execute in supplied order on the active sheet; resize, solver, analysis,
and export retain their established ordering. Invalid range syntax exits 1;
valid ranges with invalid strip layout emit a critical assertion and continue.

Procedure:
1. Run original tiny repeated linear-strip fixture through native and shared
   command/SDK engine; compare numeric cells, dependent reports and namespaces.
2. Check one-cell, vertical, four-cell and non-active qualified ranges, invalid
   syntax, bounds, error/text/boolean target coercion and input formulas.
3. Use another agent for independent difficult-root, manual-cache, unrelated
   volatile/external formula, cancellation and work-budget checks. Unit tests
   remain in memory with memfs I/O and never spawn native.
4. Run uncached maintained ssconvert build, test and lint, plus focused maintained
   safe-bash command checks after rebuilding its dependency closure.
5. Record exact measured coverage and every remaining mismatch below. Unmeasured
   cases are not passes. No README edits, push, publication or native product use.

## Verified contract and remaining differences

Native source archive checksum verified on this checkout. The fresh profile is
`docs/ssconvert/goal-seek-reference-profile.json`; it records version, linked
libraries, available locales and installed plugin descriptors and links the
captured full build/dependency profile. All four profile capture commands exit 0.

Original repeated linear CSV native command exits 0. Roots are 4 and
6.0000000000000009 (JavaScript 6.000000000000001), with dependent report 10.
The command and SDK serialize identical workbook bytes through memfs, retain
source ownership and preserve other namespace entries. Reversed bounds write
#VALUE! to the first input; a subsequent valid strip still solves to 4.

Source and native measurements agree that the five cells supply formula,
changing input, target and two bounds. No dedicated report cell is written.
Reports are ordinary dependent formulas, recalculated by the existing later
stages. Target and bounds use stored values; they are not pre-recalculated
or parsed as GUI-formatted entries. Input expressions are cleared by scalar
writes. Trial evaluation follows the target dependency chain even in manual
mode, while unrelated manual caches retain their values. Final input writes
queue dependents. Existing injected goal-seek, solver, tool, resize and export
stage ordering remains intact.

Malformed singleton, vertical and four-cell strips native exits 0 and emits
its exact assertion message content; invalid range syntax exits 1 and prints
`Invalid range specified.`. Unit cases verify continued later solver dispatch
for shape assertions, and no later dispatch for syntax errors. The product
emits assertion message content without GLib process ID/timestamp/CRITICAL
prefix bytes. Exact native critical-prefix byte parity is therefore not claimed.
The oracle's GOConf startup warnings also occur for the no-goal baseline and
remain a separate environment diagnostic difference, not product goal output.

A concrete replay regression observed 204 RNG draws instead of native-contract
202 because normal samples were discarded between ranges. Invocation-owned
state now retains the spare sample; no process-global state crosses realms.
Native ambient seed/stream identity and cross-invocation RNG state are unmatched;
random trawling requires the explicit injected random capability, while
Newton-only deterministic cases need none. Missing capability exits through the
existing capability-denied path rather than using host randomness.

Independent difficult-root cases, work budgets, manual caches, coercion,
cancellation and the validated numerical-test allocation repair are detailed
in `docs/plans/ssconvert-goal-seek-independent-qa.md`. The numerical repair
hoists an unchanged FMA component helper: existing Tukey regression measured
3516ms before and 1941ms after; focused arithmetic/statistics 63/63 pass.
No timeout or arithmetic assertion changed.

Unmeasured: arbitrary difficult roots, exhaustive precision/failure paths,
non-C numeric locales, NaN/infinite bounds, circular target dependencies,
array-group changing cells and stochastic stream equivalence. Dependency-graph
construction still parses unrelated unsupported syntax; such workbooks can
reject before target calculation. These are not counted as passes.

Ad hoc screenshot of actual virtual command success (input 4/result 8/status 0)
and invalid syntax (diagnostic/status 1) was generated under out and visually
inspected. No screenshot tests were added. Source and all temporary evidence
remain under out until reduction and cleanup; README files are untouched.

## Final candidate verification

- Maintained uncached `npm run test --workspace=@poe-code/ssconvert -- --no-cache`:
  exit 0, 277 files and 5775 tests pass, including 18 goal-seek cases. The initial
  full run failed the unchanged R.QTUKEY assertion by timeout; the final candidate
  passes it in 1929ms after the validated helper allocation repair.
- Maintained `npm run lint --workspace=@poe-code/ssconvert`: exit 0, ESLint,
  production type checks and test type checks pass on the final source.
- Maintained selected build closure
  `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  exit 0 on final source. Membership comes from maintained workspace declarations.
- Cross-workspace selected safe-bash uncached build closure: exit 0 (native and
  optional suffix stages included). Final rebuilt ssconvert command/SDK test
  file executes through the maintained Node/tsx test runtime: 61/61 pass,
  0 skipped, including identical output bytes, exact native-root doubles,
  exit-1 diagnostics and no output namespace changes on invalid syntax.
- Preliminary direct file ESLint exited 0 but is supplementary only: safe-bash
  requires the guarded root lint route, which is run separately below.

No local commits, remote delivery or release was requested or performed.
Existing edits were preserved; no README files were edited. Native ssconvert
was used only for separate QA measurements.

Guarded root `npm run lint:eslint -- --no-cache`: exit 0, complete=true,
0 errors, 4 warnings outside this change. 16990 configured subjects were linted;
38905 unconfigured entries are not counted as passes. 3732731 metadata operations,
receiptsComplete=true, cacheHits=0. The four warnings remain visible and unchanged
(docx operation-types, safe-bash docx table-model and zip-review unused bindings).
This is an ESLint gate, not a repository-wide type/release qualification.

Reduced gate evidence and SHA-256 of temporary captures before cleanup:

```json
{
  "complete": true,
  "exitCode": 0,
  "errorCount": 0,
  "warningCount": 4,
  "scope": {
    "configured": 16990,
    "linted": 16990,
    "ignored": 2044,
    "unconfigured": 38905,
    "ignoredDirectories": 166,
    "heldExcluded": 5
  },
  "cacheHits": 0,
  "metadataOperations": 3732731,
  "receiptsComplete": true,
  "evidenceSHA256": {
    "root-lint.log": "760bc8d525851b41c3e02e590f787399a416293db7ca179e1a8b72f5ca1d374e",
    "test-final.log": "2a4aaa714d67c34f8b8cb2d9f5403147ecd71cb9397575944e351e09bcad507a",
    "lint-verified.log": "c4d01086f7d2047ba347cb7ac01f353e5ab2bc83fc8844becd30dce5d2fee2c1",
    "build-final.log": "a23de0cb46c3f989747e11e06a9a80377010fb5f7b8e4d24bce4b13dd676dc54",
    "integration-test-final.log": "836afd78167a9bc7bdd5ee7eef2971c3329d8f16400ff965929988d7b87c7a1f",
    "native.json": "89f1ae0ac9edf6807a5393c3e9e19396b366ad789a694b91cd044e195b6b613b"
  }
}
```

Temporary task fixtures/logs/screenshots were purged after reduction. Existing
primary-source archives, oracle installations and unrelated out evidence remain.
