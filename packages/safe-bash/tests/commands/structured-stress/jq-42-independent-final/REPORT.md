# Independent final jq verification — scoped PASS; legacy FAIL

2026-08-27T01:30:26.934Z. Fresh independent leaf; no product authorship or delegation. Only this new subtree is owned.

## Verdict and source stability

Original42, the unchanged main corpus, and the two corrected failure boundaries pass independently at the measured source. **The legacy gate FAILS. A stable full checkpoint is NOT established.** Both attempts are retained; the one allowed retry is exhausted. No additional rerun, source fix, expectation rewrite or acceptance waiver is made.

- Source-only fix commit: 0278a3032d7851de4c2f5141bbc863cdf310c39d. Exactly src/commands/structured/input.ts and src/commands/structured/jq.ts changed in that commit; every current structured file matches it.
- Fix-author evidence commit: 22171fc27b39cc6ad5c10f95e5b869ec7038b0a7; prior independent FAIL commit: 8eb2c80351b212224df15eb9d75e02036ac60cb9; before-fix author native freeze: 8aaf610d26e8dc310bf6ac1f713cf2614cc1120e.
- Structured SHA-256 is 30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f at every recorded phase boundary.
- All 17 retry test/type/build phases share product SHA-256 1aae248a8b9c25ea871a2e6297cfc618fe605fdef4664ce031e1d35f874b214b; main HEAD is 781f272b33288d9ffcd898d5399996a646e3c3fd, not a clean committed-HEAD claim.
- Retry opening immutable scan changes product hash from 109b7e8dab43eb3a032cce29ec79b5fa0bd30a0e9278203782d556492c1b85fd to the measured hash (src/fs/s3/COMPARISON.md). Closing scan changes it to 658b61c07619bdc1d5b30adcf44fff7ce6cf14ed89b7ebe46b894c535bad59dd (src/fs/memory/index.ts). The checkpoint is explicitly INVALID as one whole-product run, despite passing phase-local results. No claim that the final moving worktree is the tested product.
- Initial attempt also spans product edits, including memory source. Raw snapshots, timing, statuses, stderr, failures and invalidated observations are retained. Pre/post equality cannot exclude transient ABA edits. Root needs a coordinated freeze for any further stable-checkpoint acceptance; this bounded leaf stops.

## Independently executed frozen cohorts

| Cohort | Actual result |
| --- | --- |
| Main unchanged vectors | 256/256; 790/790 exact executions |
| Original42 subset | 42/42; 84/84 executions; not additional to 790 |
| Historical independent155 | 155/155; 310/310 executions |
| Historical additive81 | 81/81; 162/162 executions |
| Prior reviewer20 | 20/20; 318/318 executions |
| Reviewer chunk-boundary subset | 5 vectors; 288/288 executions, included in 318 |
| Direct/public Shell routes | 395/395 each |
| Direct pipeline stages | 11/11 exact stage results, included in main routes |
| Independent host-failure controls | 7/7 × 3 = 21/21, strict unhandled rejections, 120-second process watchdog |
| Legacy native gate | 45/94 exact vectors; 180/376 exact executions; FAIL |
| Original selected red assertions | 0/22 pass, 22/22 still fail; names unchanged |

Each main result compares status, stdout bytes and stderr bytes with immutable expectations. Direct pipelines compare every returned stage and stage count; the unchanged public Shell harness compares final status and byte sinks, not cross-process stderr timing. No diagnostic normalization, missing-case skip or native recapture occurs.

The unchanged seven controls explicitly assert original rejection object identity for host Error/FsError/JqError, one diagnostic attempt, no further input reads, generator cleanup, and no replay after a successful prior diagnostic. The input-JqError control intentionally expects existing terminal status 5, not an escaping identity; no broader input contract is invented. Author six typed-sink controls independently rerun too, covering first/second failure, identity, exact write/read counts and cleanup.

## Author-origin cohorts, separately rerun

These are executed by this verifier but are not independent new cases and are not added to 790.

- Original author combined tests: 114/114, including its 10 safety tests.
- Historical wrappers: 238/238 = 155 + 81 actual vector tests + two evidence/container checks.
- Nearby/contract suite: 117/117 = 104 author nearby tests + 6 author typed-sink tests + 7 existing independent boundary tests. The 52 frozen nearby vectors cover 882 exact route/transport executions, overlapping main cases.
- Author immutable checks: 2/2. Existing independent immutable checks: 4/4.
- Ten author safety plus six author boundary tests: 16/16 on each of three strict/watchdog runs (48 repeated executions).
- Scoped harness/boundary TypeScript exits 0; global npm run typecheck exits 0. All 8 new .mjs runners pass node --check.
- Full TypeScript 5.9.3 compiler emit: 520 ESM/declaration/map files, zero diagnostics, held in memory using tsconfig.build.json with only outDir changed. No unowned dist writes. This is not an npm-script/packed-install test.
- Emitted root ESM imports without tsx; 5 existing frozen vectors × direct/Shell = 10/10 exact smoke executions (UTF-8, binary NUL, recovery, key ordering/number lexemes, malformed fromjson closing diagnostics). These overlap main and are not extra independent vectors.

## Remaining compatibility failures

The full 49-row exact reproduction table is REMAINING.md and all 376 results are r2-legacy.json. 43 vectors differ only in stderr; 6 differ in status/stdout. Every frozen probe agrees across whole/bytewise and both routes.

| Existing input | Native status / stdout | Virtual status / stdout |
| --- | --- | --- |
| `NaN` | 0 / `"null\n"` | 5 / empty |
| `Infinity` | 0 / `"1.7976931348623157e+308\n"` | 5 / empty |
| `-Infinity` | 0 / `"-1.7976931348623157e+308\n"` | 5 / empty |
| `01` | 0 / `"1\n"` | 5 / empty |
| `1.` | 0 / `"1\n"` | 5 / empty |
| `UTF-8 BOM + 0` | 0 / `"0\n"` | 5 / empty |

These six native accepts/virtual rejects remain pre-existing gaps, not parity exceptions. The remaining 43 diagnostics include invalid UTF-8/numeric EOF locations, raw scanner [}, zero-divisor wording, and four supplementary join-arity/split-index controls. The fixed recursive fromjson closing error does not fix the raw scanner [} diagnostic.

The exact 22-name selector comes from untouched jq-42-author-20260827/final-owned.tap (hash 927f32925c0f612e5c1f2f64a74addfb9fea900479c84d84e98cb985d5d28658). All 22 still fail with no skips or cancellations. No whole broad-suite count is claimed. Preserve the prior independent classification: 20 first-failure non-native policy retirements plus 2 old regex expectations with real diagnostic gaps; the resource composite also exposes six real acceptance gaps. Do not call all 22 stale.

## Immutable evidence and history

- All 170 audit-era report/structured-evidence files match 96db59ac7d355d1a94422634b4c4f53d00932ad9 byte-for-byte.
- All 28 prior-review files match 8eb2c80351b212224df15eb9d75e02036ac60cb9; all 139 prior structured evidence files match their committed captured baseline; all 32 fix-author evidence files match 22171fc27b39cc6ad5c10f95e5b869ec7038b0a7. No historical expectations changed.
- Native oracle remains frozen /usr/bin/jq 1.7.1-apple, executable SHA-256 1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f. No native process was run or fixture recaptured here.
- Independent manifest SHA-256: f4636b95d52c78b118c5eebc4a802ccf13d63a8a43c460f55da91e9f4e6ceacb. Legacy frozen expectations SHA-256: 54a844a4e2b3c7f11fd185334f07e6f283250a9f6ddd49a75268eb48bcbd83e3. Author nearby freeze SHA-256: dd7a8d16d32ed2083e2fef49de2f9b59471aeb6b0ebe6959b38e3a42d7b35743. Full original manifest and file hashes are in REPORT.json and r2-immutable-end.json.
- Retained distinct historical cohorts: original42 0/42; prior independent 788/790 and reviewer19/20; host boundaries4/7 on three runs; legacy41 exact/47 diagnostic/6 acceptance. None is overwritten, silently recounted, or pooled with current results.

Two initial verifier setup failures remain visible: r1-legacy.json uses the main-only filename guard and records eight harness errors for two legacy file fixtures, corrected solely by reproducing the frozen legacy harness setup; r1-immutable-before-command.json counted only 95 report files rather than the original three-prefix 170-file set. Neither is a product failure or native expectation change.

## Commands and ownership

Run commands from the repository root; use a new output name, never overwrite an artifact:

~~~sh
node tests/commands/structured-stress/jq-42-independent-final/command.mjs fresh-main node --import tsx tests/commands/structured-stress/jq-42-independent-final/replay.mjs main fresh-main-results.json
node tests/commands/structured-stress/jq-42-independent-final/command.mjs fresh-legacy node --import tsx tests/commands/structured-stress/jq-42-independent-final/replay.mjs legacy fresh-legacy-results.json
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts
node node_modules/typescript/bin/tsc -p tests/commands/structured-stress/jq-42-independent-final/tsconfig.json
npm run typecheck
node tests/commands/structured-stress/jq-42-independent-final/build-smoke.mjs fresh-build.json
~~~

Every exact command, watchdog, raw TAP, before/after source/tooling hash and exit status is retained in r2-*.json. r2-legacy-command and r2-legacy-red deliberately exit 1; r2-checkpoint is not green. Generated files use apply_patch only. No product/root/docs/archive/FS/shell/prior-review edits, no added dependencies, no uploads or children. Final evidence commit is identified by the handoff and git history for this subtree. No full jq parity, superiority, project closure or 72-hour duration claim.
