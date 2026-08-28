# Qualified H11 R3 — consumed attempt, integrity HOLD after 6/14

2026-08-28. **One launch, coordinator exit1, HOLD_OR_QUALIFIED_RED.** This is not
the prospective all-runtime-qualified/native-unqualified outcome. Authorization
021302a1 is consumed; no retry, repair, permission change or new phase followed.
Old8e6b/df89 andc222/55db remain consumed0/14, not replaced by this partial run.

## Exact launch and chronology

- Grant: `ROOT-2026-08-28-UNIFIED76-QUALIFIED-H11-R3-ONE-ATTEMPT`.
- Metadata acceptance: `e5ed3ecb87d0914e6967ece3da890ad8de7c844f`.
- Packet: `69f5cc1b05484c9d0836edf77bfbbbfb46145383`, normalized
  `d236cc7723dfaf860e3e70cda1d04bff2f46950c54c845d8ac0184e969296b00`.
- Product: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; expected packagec109372f,
  **not packed in this attempt**, not current78/HEAD.
- Driver: `aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424`;
  effective profile: `fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510`.
- Receipt1333 bytes, SHA256
  `f61bace1ea85dc1aa19b8f80728cbc4526148fbca424ac452a818471c28dc847`.
  Exact committed bytes were staged at the prescribed new /tmp path before run.

The exact command in packet LAUNCH.md:113 ran once as exec session93642. Receipt
verification occurred13:56:40.466Z; ADMISSION was observed by13:57:20.488Z.
Inner report start13:57:13.485Z, finish14:06:52.855Z. These are distinct observed
timestamps, not a reconstructed exact outer-process start. The terminal CLI
returned exit1 and printed:

```json
{"outer":"/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-KRlFdr","status":"HOLD_OR_QUALIFIED_RED","candidate":"f5e9fc49b6abb38e180cc9de16c95fced102ff75"}
```

## Phases actually reached

| Phase | Actual / expected status | Process receipt |
| --- | --- | --- |
| safejs-availability |0 /0|closed, clean|
| cold-typecheck |78 /78|closed, clean; prerequisite status, not a type failure|
| typecheck-all |0 /0|closed, clean; one driver production build|
| benchmark-types |1 /0|closed, clean; checker not reached|
| env-source-binding |0 /0|closed, clean|
| canonical |1 /0|closed, clean; raw failures/skips|
| current-consumers |NOT_EXECUTED|integrity halt|
| pack |NOT_EXECUTED|integrity halt|
| public-runtime |NOT_EXECUTED|integrity halt|
| public-types |NOT_EXECUTED|integrity halt|
| negative-types |NOT_EXECUTED|integrity halt|
| missing-root |NOT_EXECUTED|integrity halt|
| missing-contracts |NOT_EXECUTED|integrity halt|
| final-sweep |NOT_EXECUTED|integrity halt|

All six supervised phase receipts record zero faults/signals/survivors and closed
captures. The outer worker exits1 naturally, closed/clean, zero observer faults,
signals and recorded survivors. Observer survivors are empty. Nevertheless
aggregate fence cleanliness is false (6/13 phase dispatches), and inner
bindingComplete/guardsPassed/cleanupComplete are all false. This does not claim
universal descendant/kernel cleanup or a successful final sweep.

The outer additionally reports `inner driver binding or verdict failed`.
Both raw reports are retained; no diagnostic was suppressed or rewritten to
qualify the result. H06 persistence succeeded for this recorded failure; no
actual dual-private-error injection occurred, so its conditional qualification
is unchanged. H11 scoped acceptance is not broadened by this run.

## Concrete blockers and raw accounting

**Benchmark typing:** `benchmark-types.stderr` records ENOENT at
`harness/build-audit.mjs:8` for the frozen
`source/benchmarks/node_modules/typescript` path. Phase exit1 occurred before the
benchmark checker. No fallback, dependency copy or rerun was attempted. This
needs a gate-harness dependency-route diagnosis, not a claimed TypeScript pass.

**Integrity halt:** after canonical completion, the source additions/removals/
content/type/mode guard rejects exactly286 added entries:

- 71 roots under `tests/commands/table-text-stress/.native-*`, each retaining
  its directory plus `left`, `right`, `sentinel` (284 entries).
- `tests/commands/table-text-stress/shared-stdin-fix/.runtime`.
- `tests/fs/mount/identity-authority-review/implementation/.runs`.

These are recorded source-tree additions, not alleged modifications to existing
source or a proven background-process leak. All paths are in SUMMARY.json and
the original error/stack in raw REPORT. The approved guard stopped dependent
work; no cleanup of these retained evidence paths or oracle adjustment followed.
Fixture owners need independent attribution before any successor repair.

Captured TAP reconciles exactly: **19,425 PASS /132 FAIL /7 SKIPPED /0 TODO /
0 CANCELLED;19,564 test instances**. The footer and all case diagnostics remain
raw. The source-bound TAP parser was run as offline data analysis after exit,
not another suite. Original inner REPORT never reached canonical accounting
after the integrity error; offline data does not replace its verdict or prove
all632 selected files executed. Load traces are retained for separate analysis.

### Routing inventory, not causal classification

| Frozen path | Failing test instances |
| --- | ---: |
| tests/commands/diff-patch-stress/editflows/oracles.test.ts |4|
| tests/commands/diff-patch-stress/gnu-auxiliary/authorization.test.ts |34|
| tests/commands/diff-patch-stress/gnu-target-followup/native-controls.test.ts |18|
| tests/commands/diff-patch-stress/gnu-target-followup/overlap-default.test.ts |2|
| tests/commands/diff-patch-stress/gnu-target/calibration.test.ts |5|
| tests/commands/diff-patch-stress/path-regressions/envelopes.test.ts |12|
| tests/commands/diff-patch-stress/safety/paths.test.ts |2|
| tests/commands/expr/inactive-prefix.test.ts |6|
| tests/commands/metadata-stress/chmod-controls.test.ts |1|
| tests/commands/metadata-stress/native-differential.test.ts |1|
| tests/commands/metadata-stress/permission-profile/darwin-profile.test.ts |2|
| tests/commands/metadata-stress/permission-profile/qualification.test.ts |1|
| tests/commands/search-stress/pipelines.test.ts |5|
| tests/commands/search-stress/safety.test.ts |1|
| tests/commands/search-stress/streaming.test.ts |1|
| tests/commands/stream-inspection/native.test.ts |1|
| tests/fs/real/adversarial.test.ts |1|
| tests/integration/s3-http-exports/exports.test.ts |1|
| tests/plugins/qualified-current-release-native-data/controls.test.ts |1|
| tests/shell-stress/script-entrypoint/holdout.test.ts |1|
| tests/shell/heredoc.test.ts |2|
| tests/shell/inline-input-fatal-scope.test.ts |30|

Exact names/locations/details for every failure and skip are in
`TAP-NONPASSING.json`; the full TAP is also retained. No classification here
asserts all132 are virtual-product bugs, native eligibility losses or harmless
harness failures. For example the diff edit-flow identity case reports
`spawnSync /usr/bin/git EPERM`; the Real special-node case reports socket
`listen EINVAL`. Their specific causes require diagnosis, not broader permission.
The two Darwin/Node22 characterizations remain raw Node24-profile observations.

Seven skip rows name base64/base32 Python controls, two Vim xxd controls, cksum,
optional GNU grep and optional BSD grep. Some reasons are blank and others cite
absent selectors/oracles; preserve the exact strings. They are not passes or
proof that a tool is globally uninstalled. No zero-skip qualification is claimed.

## Setup, private scope and retained resources

All nine maintained stages reached completion: authorities/metadata/
stageMetadata/archive/group/bytes/privateBefore/privateCopy/privateAfter.
Historical NA-2755/NA-6755 retain their exact unsupported/unqualified records;
admissionProbesRepeated=false. Canonical operations/failures are not subtracted
or automatically assigned to those two historical FILE observations.

The materialization receipt reconciles37,397 logical candidate entries with
37,392 physical entries and the exact five instruction metadata omissions.
Benchmark dependencies separately omit their one declared instruction entry.
No instruction plaintext body materialization or exception expansion is claimed.
Only fixedf5 and bound dependencies execute; no live-feature overlay or wider
permission/tool route was supplied.

Private source HEAD in the captured guard isbb23ec270aaaf1d394b00d330fbf1aa6ccb2952e.
The pinned prerequisite stages264 regular engine-package files. Recorded
privateUnchanged=true and privateFileChanges=[] are the existing run's checks,
not a fresh independent private inspection or blanket private certification.
No private command, status/index refresh, copying or source access was performed
while analyzing/capturing these terminal receipts.

Retained roots, untouched after the run:

- output: `/tmp/full-gate-unified76-f5-historical-h11-20260828-r3`
- outer: `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-KRlFdr`
- temporary: `/private/tmp/unified76-os-write-9hZxpj/tmp/unified76-execution-FQM0aw`

The original cleanup note explicitly retains temporary evidence. No broad
cleanup, source restoration, failed-root mutation or unowned signal occurred.

## Append-only evidence and remaining authority

`capture.mjs` was authored after terminal settlement; it only reads existing
output/outer files, authenticates the41/35 bindings and parses captured TAP.
No pre-code independence claim or runtime rerun. It streams/hashes/compresses
all928 regular files (nine directories), **114,734,734 raw bytes**, into
**11,430,146 gzip bytes** plus base64 transport. Every gzip roundtrip and the
raw output inventories/bytes before/after capture match. EVIDENCE.json binds
all raw/encoded hashes, modes, paths and finite capture limits; raw roots remain.
The retained source tree is not recopied into this evidence archive.

The exact one-shot grant is consumed by this launch. Fresh independent diagnosis,
any separately authorized source/fixture repair, metadata review and a new ROOT
release are required for further execution. No package phase, complete14-phase
gate, currentHEAD or broad-superiority acceptance follows from these counts.
