# Current repeated goal-seek candidate QA

Preserve the existing implementation and historical evidence. This verification
uses the September 21 checkout; README edits, commits, pushes and publication are
outside this task. Primary source remains in out. Rechecked archive SHA-256:
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.
The captured native dependency/plugin/C-locale profile is
docs/ssconvert/goal-seek-reference-profile.json. It is historical Linux ARM64
evidence, not a fresh native run on the current Darwin host.

## Manual procedure

1. Inspect dialog-goal-seek.c test mode, tools/goal-seek.c, value.c and goffice's
   go_strtod. Map upstream t7000-goal-seek.pl; t7100 is solver blending.
2. Add an in-memory signed-zero input regression, observe failure, then repair
   raw coercion. Verify hexadecimal rejection and malformed numeric prefixes.
3. Have a different agent independently stress callback ordering, bounds,
   dependency evaluation, cancellation and work budgets. Keep unit tests fast
   and in memory. Native is never a unit or product dependency.
4. Run uncached selected maintained ssconvert tests, lint and the safe-bash build
   closure, then command/SDK integration on the rebuilt dependency. Review
   original/checkpoint/replay goal-seek effects through injected byte I/O.
5. Record all outcomes and limitations; reduce temporary logs before cleanup.

## Observations

An initial raw string signed-zero test failed, but further source review
disproved its expected -0 output: value_new_float canonicalizes zero to +0.
The invalid regression and proposed parser change were removed. The first
maintained run therefore failed 1/5776 cases due to a bad expectation; it does
not qualify the candidate. A second run overlapped the independent NaN-bound
red regression and likewise does not qualify the frozen candidate.

Independent review confirmed three real regressions before repairing them:
failed left derivative evaluation must skip the right callback; accepted
nonfinite guesses must be written as #NUM! (a constant target may still succeed);
and NaN bounds must enter uniform trawling before normal trawling. Original
bounded callback traces and constant-expression fixtures reproduce these without
native execution or slow unit loops. Details are in
docs/plans/ssconvert-goal-seek-current-review.md.

XML checkpoint/replay integration initially exposed three fixture errors: a
100-byte input limit, a missing SheetNameIndex, and a rounded expected root 6
instead of the captured binary double 6.000000000000001. Each failure was
investigated and corrected without altering product behavior.

Ad hoc screenshot of the actual virtual command was visually inspected: repeated
linear roots/report output exits 0; invalid range syntax exits 1 with the exact
`Invalid range specified.` content. An initial screenshot driver lacked required
plugin configuration; corrected driver capture exits 0. No screenshot tests added.

Frozen dirty candidate base HEAD: b97c4938a469ee70e09bd08a0e5fcf7e868ca04c.
This is not a committed revision. Product/source SHA-256:

- goal-seek.ts: 65af53496b476296de670fd2d946b9d294f8d1cc1f96577a0f51e2b91487327f
- financial-goal-seek.ts: eecd20e322dbee0ebf9f0856f6fe6dfaad3720ab6288fa168abd98e9e0340c04
- goal-seek-review.test.ts: 4687deb7481465418d6517e1e45e46efaf06e803d6f18197062d628edde8c658
- safe-bash ssconvert.test.ts: 48c1455fad5779e90e5c2fedf940a102750f61e51270213632d402d6fe406259

The final negative integration case specifies its exporter explicitly: without
an extension on `/keep`, format selection correctly fails before goal seek with
status 2. That fixture error was corrected; range syntax now reaches its intended
status-1 path and preserves every namespace entry and existing output byte.

## Frozen candidate results

- Maintained uncached ssconvert workspace test: exit 0, 278 files and 5789 tests
  pass. No failed/skipped/todo cases reported. Entire workspace rerun after the
  final product edits, rather than counting a focused rerun as this gate.
- Maintained ssconvert lint: exit 0, ESLint and production/test TypeScript checks.
- Maintained uncached safe-bash build closure: exit 0; declared dependencies,
  native/optional suffix stages and root selected-build accounting completed.
- Rebuilt safe-bash ssconvert command test through maintained Node/tsx runtime:
  exit 0, 62 pass, 0 failed/cancelled/skipped/todo. This is a selected command
  file, not the complete safe-bash workspace test gate.
- Final integration-file ESLint: exit 0, supplementary to guarded root route.
- Independent selected stress/financial checks: 122 pass; fast callback-order,
  capability-denial, cumulative-budget and exact cancellation-reason controls.
- Screenshot generation and visual inspection: pass after driver repair.

No shared host/realm authority API changed. Tests cover injected random authority
denial, cancellation and byte I/O with memfs; no host process/filesystem fallback
was added. Browser/Worker/SafeJS hostile-host isolation, full realm matrices and
unrelated broad repository build/test gates were not executed and are not passes.
This focused solver change is covered by the complete owning workspace tests and
cross-workspace build/command checks. Source hashes above identify the dirty
candidate; no local commit, remote delivery or release occurred.

Fresh native differential runs are unavailable: retained ssconvert is Linux
ARM64 ELF and Docker cannot connect to its daemon. Prior difficult-root captures
remain historical evidence. Non-C locales, exhaustive convergence, stochastic
stream identity, circular dependencies and array-input behavior remain unverified.
Native GLib critical prefix bytes remain unmatched. Explicit injected random
capability is required for stochastic fallback; this is a known authority-profile
difference. No completion claim covers these matrix cells.

Guarded uncached root ESLint completed: exit 0, complete=true, 16991 configured
subjects linted, 0 errors and 4 unrelated warnings. Unconfigured entries are
not passes. This gate began before the final integration fixture correction;
the final integration file also passed a supplementary ESLint run after that
correction. No full repository unit/type/release gate is implied.

Reduced temporary evidence before cleanup:

```json
{
  "complete": true,
  "exitCode": 0,
  "errorCount": 0,
  "warningCount": 4,
  "scope": {
    "configured": 16991,
    "linted": 16991,
    "ignored": 2044,
    "unconfigured": 38907,
    "ignoredDirectories": 166,
    "heldExcluded": 5
  },
  "cacheHits": 0,
  "metadataOperations": 3732838,
  "receiptsComplete": true,
  "evidenceSHA256": {
    "goal-seek-current-test-final.log": "acef804493b32f1ed17cb2df1b5efbda9763d3e159b37a1edc040f566904210a",
    "goal-seek-current-integration-lint.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "goal-seek-current-build-final.log": "63e3e5e3f10bfdbfb6c0ee05476c0e7e356d72c562a9512c05b2731f8e88aa36",
    "goal-seek-current-integration.log": "765f9982ce6b1f71ee6994521352ef1ce40f689db149163e093fd711cae14f1a",
    "goal-seek-current-screen.mts": "a3ce0176d6e3f75065bd373873cfc4f05d9cb0ee545b4f52c48dda845e9d1b20",
    "goal-seek-current-screen.png": "6306b3d424b81bf086491505e2c000c2d81abf8594aaa3e0f892b6d49908050e",
    "goal-seek-current-frozen-integration.log": "8fc4b824c35456f093de9eac5aefccb9409abb7964e3ef9ac26919aed39fbaba",
    "goal-seek-current-frozen-lint.log": "c4d01086f7d2047ba347cb7ac01f353e5ab2bc83fc8844becd30dce5d2fee2c1",
    "goal-seek-current-test.log": "62f1cd2637f4111d7d00d20a3d61ac82a29448a435cfc3d8aed6dfd9f7ce0374",
    "goal-seek-current-screen.log": "034179484a34400627eabdf323cc6505b6c750a1834c7976335c2648b91e26ce",
    "goal-seek-current-red.log": "6c1aebc3849a2a86f0f5845e3d09a06dcc2320ef0c731c43724edfb62c650df2",
    "goal-seek-current-frozen-build.log": "e2d3b16cc16518f047a1b55dab71183926f381090c5583c14f6e8fc5f01e8f85",
    "goal-seek-current-integration-second.log": "4692948fa08ea4518670b6a9607a64c9f78079c1e71c4dd1e6eeb5114c32127f",
    "goal-seek-current-lint-final.log": "c4d01086f7d2047ba347cb7ac01f353e5ab2bc83fc8844becd30dce5d2fee2c1",
    "goal-seek-current-root-lint.log": "4d02c5e06b2031ee9563e4317fcfdc9451eaf44075448aa697179b7bf714f267",
    "goal-seek-current-integration-third.log": "cd80849c4a74622d4afbaf9f2881783a52edbc386c90928cf03da225356a074c",
    "goal-seek-current-verified-integration.log": "afc6268652c89ac0f920b7fefc6f9994a429b726018856c00efd8ba98b572242",
    "goal-seek-current-build.log": "63e3e5e3f10bfdbfb6c0ee05476c0e7e356d72c562a9512c05b2731f8e88aa36",
    "goal-seek-current-lint.log": "c4d01086f7d2047ba347cb7ac01f353e5ab2bc83fc8844becd30dce5d2fee2c1",
    "goal-seek-current-frozen-test.log": "86acaaa41c32652a6d7c58819c4fb6bb6fc08e5132e81960609c826b873d46ee"
  }
}
```

Owned temporary goal-seek-current logs, driver and screenshot were purged after
reduction and visual inspection. Primary source/oracle and other evidence remain.
