# Independent current-release execution: qualification FAIL

## Final execution phase — August 27, 2026

A fresh, different execution leaf took over the closed preparation worker's
directory. No delegation or fiction of resuming that worker. Root's exact ready
marker authorized commit `02a78bf64c29dedcd69071551ed5848b0765c107`, tree
`4ccfddf7f7e521c29aa675cf09ca95f39870718b`; it is archived with the coordination,
preparation result, author result and other-agent diagnostic in
`execution-evidence/`. Neither moving HEAD nor the dirty worktree was executed.

**The actual current-source positive outer job exits 1.** The unchanged maintained
WebDAV consumer still fails existing-target `mv` to-remote with
`EAGAIN: resource temporarily unavailable, utimes '/remote/target'`: **12/13**,
one failure, zero skips/cancellations/TODOs. This is fresh evidence for current02,
not recycled author545 counts. The later passing native/public phases do not
waive the consumer failure. Root was notified before any correction through the
assigned `execution-needs-root.txt`; no source/provider correction was attempted.

Positive outer execution: **2026-08-27T08:23:24.460Z–08:24:03.793Z**, 39.333 seconds,
exit1, no signal. This is command elapsed time, not a claim of 72 hours of work.
All subprocesses are finite/synchronous; no watcher, gate wait or stopped worker.

```sh
LC_ALL=C LANG=C TZ=UTC npm run verify:release:qualified -- --source-commit 02a78bf64c29dedcd69071551ed5848b0765c107 --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7" --archive-tar-from "$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"
```

The command runs in this directory's ignored `.execution-work/launcher`, an
immutable Git-archive launcher with a read-only Git directory reference and
existing `node_modules` symlink. Native asset copies occupy the required `$PWD`
locations. Its committed outer job creates its own isolated candidate, builds
there and uses owned npm caches. No root `dist`, dependency installation, global
write, diagnostic-provider overlay, branch or host/native ownership change.
The author's `rootDistUnchanged` assertion concerns the isolated launcher, not a
fabricated before/after measurement of the shared repository's `dist`.

Exact argv, environment, start/end times and stdout/stderr are in
`execution-evidence/positive-outer.json`; every child record and complete result
are retained under `execution-evidence/positive/`. The three outer prerequisite
controls run **before** the positive, without `--check-only`: GNU_TAR-only,
explicit nonexistent owned asset, and exact executable text
`independent wrong GNU tar pin\n`. Each exits **78 before zero tests**, and the
wrong binary is rejected by SHA before execution. The inner negative candidates
have no staged GNU tar; launcher provisioning does not substitute for the
required explicit argument.

## Frozen Q01–Q14 outcomes

These are **12 passing controls and 2 failing controls**, not fourteen product
tests and not a passing release. `verified-controls.json` supplies exact evidence
checks and reasons. In particular, correctly propagating a failure is not Q06
positive qualification.

| Control | Outcome | Actual bounded result |
| --- | --- | --- |
| Q01 immutable binding | PASS | Exact ready/tree; all205 source/config,380 test/support and20 harness entries independently match Git and the executed candidate. |
| Q02 per-path census | PASS | All156 tracked `.mts` paths classified; original30 crosswalk preserved. |
| Q03 build-first strict consumers | PASS | All22 maintained files,13 strict NodeNext/declaration groups; actual installed built declarations, no source paths. |
| Q04 actual local runtime | **FAIL** | Required WebDAV12/13; eleven other runtime groups exit0 with module-only limits stated below. |
| Q05 no-fallback negatives | PASS | Missing dist TS2307; missing declaration TS7016; sole appended type error TS2322; source read denied. |
| Q06 exact outer positive | **FAIL** | Current02 outer exit1; later passes never cancel failure. |
| Q07 authentic tar | PASS | Both original suites use hardcoded candidate GNUtar1.35 path; all archive pins verified. |
| Q08 env-only | PASS | Outer78, zero tests; valid GNU_TAR is insufficient. |
| Q09 missing tar | PASS | Outer78, zero tests, explicit ENOENT. |
| Q10 wrong pin | PASS | Outer78, zero tests; no wrong-tool execution. |
| Q11 retained native/public scope | PASS | Metadata318/318+22 native rows;164 semantic/124 strict+40 stderr; existing65-name defaults, registry31 and author packed21. |
| Q12 current archive | PASS | Current02 original11/11, zero skips; all4 source/helper hashes unchanged versus historicale36. |
| Q13 authority profile | PASS | Unsandboxed native uid501/gid20/member20,0022 umask,0700 fixtures; special-mode probes preserved. |
| Q14 integrity and limits | PASS | No fixture/source edits or runtime dependencies; five cleanup failures explicitly OPEN. |

## Current consumer inventory and coverage

`candidate-census.json` records every path/SHA, original-30 membership,
preparation SHA/delta and named author disposition. The candidate has **22
maintained**, **129 historical evidence**, **1 frozen time-env oracle explicitly
pinned by its author to d904ca9**, and **4 imported declarations**. Preparation
had151 nondeclaration `.mts`; current has152. The one new nondeclaration path is
disclosed, not silently excluded or scored. Original30 remains **12 maintained
and18 historical**. No all-TypeScript claim; accepted Dirac470/470+485/485 and
historical11/30 omissions are separate denominators, not rerun here.

| Maintained group | Files | Strict compilation | Actual runtime scope |
| --- | ---: | --- | --- |
| Five regex groups | 5 | 5/5 groups pass | Five unchanged emitted consumer programs exit0; no lifecycle closure claim. |
| S3 constructor | 1 | Pass | Existing in-memory constructor consumer6/6. |
| S3 HTTP author/independent | 2 | 2/2 groups pass | Module imports exit0 only; exported service workflows not invoked. |
| S3 rmdir | 1 | Pass | Constructor smoke only, not MinIO/rmdir acceptance. |
| WebDAV loopback | 4 | Pass | Unchanged serialized HTTP consumer12/13, **FAIL**. |
| WebDAV services/research | 7 | Pass | Compile-only, with unchanged shared example/HTTPS companions; no provisioned Apache/WsgiDAV runtime or deployed-provider pass. |
| Stream inspection/five | 2 | 2/2 groups pass | Both existing emitted consumer programs exit0. |

All consumer configurations use strict NodeNext, `skipLibCheck:false` and real
built public declarations. The cold build precedes consumer compilation.
Missing-dist/missing-entry controls produce expected resolution errors plus
consequential type diagnostics; they are not mistaken for the intended-error
control. Only the copied missed WebDAV consumer receives the frozen line
`const independentReleaseTypeControl: number = "must fail";`; its compilation
has **exactly one error, TS2322**. Original consumer bytes remain identical.
Source resolution lists contain no source fallback, and the Node source-read
negative fails with `ERR_ACCESS_DENIED`. Existing worker-entry/Node permission
guards remain; no `--allow-child-process` or permission waiver.

## Native profile, public scope and identities

Host: Darwin arm64; Node22.22.2, npm10.9.7, TypeScript5.9.3, tsx4.23.12,
`@types/node`22.20.1. Exact executable/compiler/package hashes are in
`verified-controls.json` and `positive/result.json`. Environment C/UTC, offline
npm, no external network workflow; declared local consumer loopback remains
available. Native execution is unsandboxed; **no OS network-isolation claim**.

The new staging parent and native fixture parent are user501/group20; group20 is
a measured member. Native fixture mode0700, umask0022, ACL output retained.
Pinned GNU chmod probes preserve0644→02755 and0644→06755. No normalization was
needed in the observed run. No host/repo/bin chown; old nonmember-gid and sandbox
mode-stripping failures remain historical evidence. **Historical SGID6 remains
unchanged**, not relabeled resolved.

Metadata15 authenticated assets include the distinct benchmark stat;318/318 and
22 native rows pass with zero skips. Stream82 inputs/164 executions retain
164 semantic outcomes,124 strict and40 stderr differences;18 wrapper tests pass.
`positive/current-profile.json` preserves exact old/current harness hashes and
the author's explicit default60→65/API-profile migration. This is not unchanged
all-input native semantics. Original archive input/helper digests equal e36,
but **the executed source is current02**, not the historical e36 runner.

Existing registry31/31 and moved packed author consumer21/21 pass; seven packed
type negatives reject and the positive type input compiles. Two offline packs
are byte-identical, SHA256
`78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937`.
The65-name registry assertion is a scoped default API check, not superiority.
These21 cases are the executed **author cohort**, not a new independent native
corpus. Previous b7ae packed28/28, six strict negatives and eight OS controls
remain separate historical proof; no current02 OS-boundary claim is imported.
The npm prepare-sentinel observations are packaging mechanics, not closure of
the five open runtime cleanup failures.

| Binding | SHA256 |
| --- | --- |
| Ordered205 source/config entries | `512c1aaea9a7d33e12b40b14830ca52407bf6dbc845eb689b5b3ce92bd88734a` |
| Ordered380 test/support entries | `44cf89b54c6c8f1206c5796ec471614f2f1cf675d2513006b6a4ac160192b4bd` |
| Ordered20 author harness entries | `441113e3bb31aa2443f9386f0f115dbf72e534a83bee4437fec7acf46cac1f35` |
| Executed selected source archive | `1611485dfd6257aa624752287ac993bfac8713ae87e0994dbc7530fd69315533` |
| GNU tar1.35 | `49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66` |

Every source/test/helper path hash, all native15/stream/archive pins and archive
test hashes are retained, rather than only these aggregate identities.
`binding.json` records preparation deltas. Since author-tested545, the candidate
changes exactly `src/fs/webdav/{README.md,index.ts,webdav.ts}`; consumer fixture
bytes remain unchanged. Source/config/test manifests match after execution.

## Owner handoff and first-failure preservation

Root must route **Poincare** the unowned provider fixture, principally
`tests/fs/webdav/consumer/provider.mts`, with any focused regression edits
explicitly authorized. The current failure is at `consumer.test.mts:38`;
`positive/consumer-webdav-loopback-consumer.test.mjs.json` contains the exact
permission-guarded command and assertion. Keep EAGAIN and all13 assertions.

Other-agent76944's read-only f12141d diagnosis is archived under
`other-agent-webdav/` with per-file original hashes and provenance: accepted
timestamp dead property is omitted from PROPFIND, while backing.utimes changes
the ETag. Its copy-only13/13 result is **diagnostic, not this execution, not a
fix or approval**. Wrong namespace, stale ETag, rounded values and per-property
denial observations remain attached. No diagnostic provider was fed to current02.
A truthful provider-side extension roundtrip is the requested owner work; do
not weaken assertions or infer a deployed-service guarantee from loopback.

Separate first phases remain visible:

- Author545 original outer failure and prep-only static7/7 are archived unchanged;
  neither is current execution proof. The original preparation report follows.
- Fresh current02's first and only positive run fails; there is **no repaired
  candidate/retry or acceptable-pass relabel**.
- Own `postcheck.mjs` finishes all three type negatives, then exits1 because its
  initial text archive adds a final newline to another agent's newline-less
  `baseline.json`. The exact assertion/expected/actual hashes and original
  script/copy are retained in `own-first-failures.json`. This is an archive
  mechanics failure, not a new consumer failure. Separate `archive-handoff.mjs`
  corrects only owned evidence storage with base64 exact-byte envelopes; all six
  decoded originals verify. Earlier other-agent permission-path and observer-only
  consumed-stream failures are preserved in those envelopes too.

Execution commands: `node .../execute.mjs` (driver exit0, captures product exit1),
`node .../postcheck.mjs` (exit1 at archival stage after type negatives),
`node .../archive-handoff.mjs` (exit0 exact-byte archive correction), and
`node .../verify-evidence.mjs` (mechanical evidence audit, not a product gate).
All scripts are in this directory; no generated artifact requires root writes.

**Five original public cleanup failures remain OPEN.** Runtime/regex commits
alone do not close them. Root owns routing to the proper source/fixture owners;
this leaf finishes its bounded evidence/commit without waiting for a fix.
No full-package, lifecycle, release-ready, fullGNU, allTS, superiority,
deployed-provider, universal parity, duration or completion claim follows.

---

# Original preparation phase (retained verbatim): not release qualification

## Status

Independent control freeze committed as
`45041534d1c1ead57f8057ac6b33b3b981307ce6` before author42631 implementation
inspection. No delegation. Preparation completed without running any product,
consumer, native oracle, build, pack or mandatory gate. The exact root-owned
ready marker was absent at the bounded checks. No wait loop or background
watcher was started. Final qualification remains **NOT RUN / NOT AUTHORIZED**.

`node --check tests/integration/qualified-current-release-review/audit.mjs`
completed successfully. The read-only preparation audit records **7/7 static
checks passing**, not seven product tests or fourteen accepted release controls.
Its output is `preparation-audit.json`; all Q01–Q14 execution controls remain
unexecuted. No product defect is established by this preparation.

## Census and identities

- Inspected immutable preparation source:
  `90c1a3cb04a6a01e456544cbac747b327a8dfb1d`.
- Preparation tree: `bf3a0b6ccf589bd883b564011bae0b434e50707a`.
- SHA256 of the ordered 201-entry source path/SHA256 list:
  `4081eb66f76e8f2baf92b8089992b153d36828c84d9b099acfc17b631ba7035c`.
- 151 standalone `.mts`: **22 maintained**, **129 retained historical copies**.
  Four `.d.mts` declarations are separate. Every path, blob and SHA256 is frozen.
- All original 30 paths are accounted for: **12 maintained**, **18 historical
  copies**. The old e36 11 omissions and later 30 omissions are distinct original
  denominators. Canonical 470/470 and 485/485 evidence remains separate.
- The author inventory matched the independent exact maintained and standalone
  path sets at preparation. This is not final candidate inventory verification.

Maintained scope includes the missed WebDAV `consumer.test.mts`, its three
companions, five regex consumers, four S3 consumer/workflow modules, seven
WebDAV provider/research modules, and two stream consumers. All 22 require
strict built-declaration checking. Provider unavailability cannot waive types.
The actual local serialized WebDAV and S3 constructor tests remain required
runtime checks. Exported S3 HTTP workflow imports are not workflow execution.
Provider TLS/backing/service prerequisites were not launched or provisioned;
no unavailable provider runtime is counted as a pass.

## Static implementation review

After freezing, the independent leaf inspected author scripts and helpers only
as permitted preparation. Exact observed helper SHA256 values are retained in
`preparation-audit.json`. These were active/moving author bytes, not a coherent
authorized final snapshot. Source/config/author files were never edited.

The inspected design builds isolated source before strict consumer compilation,
copies built package declarations into a separate consumer tree, checks compiler
resolution, stages existing provider siblings without original-fixture edits,
and separately labels compile-only/provider and import-only scope. It requires
explicit archive provisioning and verifies the original tar pins before tests.
These observations are **not runtime proof** of correct behavior. Missing-dist,
TS2322, GNU_TAR-only, missing-tar and wrong-pin negatives remain unexecuted.

Both archive suites and both support files independently match historical e36
and preparation bytes:

| Path | SHA256 |
| --- | --- |
| `tests/commands/archive/native.test.ts` | `a7bde7f866349006aa5fce9f8615a4190ee279212e88fdd2a8568f45b88f3e45` |
| `tests/commands/archive/helpers.ts` | `7a9e593f5fa7a9e003c4ee9d481df072c0acb17b4a46ee2db321356833a819e0` |
| `tests/commands/archive-stress/pax-independent/controls.test.ts` | `1e64cbc1953b50846b5af1448cbe2dcb3d578b82d124e6e8e0967dd938befa56` |
| `tests/commands/archive-stress/pax-independent/fixtures.ts` | `3abeb1283fe401794383d366087e29589fbe38f8bef22164933785ba82d87673` |

Both original relative oracle resolutions target
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`. Required GNU tar 1.35
SHA256 is `49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`;
the original Apple BSD/gzip/gunzip pins must also authenticate. No actual tool
profile was executed here. Historical e36 archive 5/6 then 11/11 is retained
context, never current qualification. No host pins or native artifacts changed.

## Resume requirements

Root must provide the exact
`/tmp/safe-bash-qualified-current-release-review.ready` containing actual
ROOT-OBSERVED author42631 CLOSED/code0, immutable combined SHA/tree, exact outer
release command and prerequisites. Commit presence alone is not observed closure.
No exact authorized release command is available at this handoff. The inspected
command shape, **not an executed or approved command**, is:

```text
npm run verify:release:qualified -- --source-commit FULL_SHA --native-assets-from ABSOLUTE_COREUTILS_DIRECTORY --archive-tar-from ABSOLUTE_EXISTING_PINNED_GNU_TAR
```

The independent read-only candidate audit is prepared:

```text
node tests/integration/qualified-current-release-review/audit.mjs --source FULL_SHA --tree FULL_TREE --release-command 'EXACT_MARKER_COMMAND'
```

It reads the marker and immutable Git data and refuses absent authorization.
It does not execute the supplied command. Runtime orchestration and capture of
the frozen negative controls plus exact outer positive must still be performed
in owned isolated staging, never the root checkout or root dist. Do not import
author helper modules into the root as a way to test provisioning: their normal
output paths are author-owned. Any newly added standalone path needs explicit
census reconciliation; the original freeze must remain immutable.

Native authority must record actual runtime/uid/gid/groups/umask/parent gid/ACL,
initial modes and all binary/source/test/helper hashes. Use the measured member-
group fixture-parent and unsandboxed native-reference profile only; retain
first316/318, sandbox mode stripping and six historical SGID differences.
Prior b7ae packed OS-denial 28/28 and controlled native318/22 are separate
historical evidence. No duplicate eleven-input public corpus or broad new native
corpus is authorized. Preserve metadata15, stream-native pins and public65 scope.

## Open limits and ownership

Five public premature-cleanup failures remain **OPEN**. No lifecycle, full GNU,
all-TypeScript, release-ready, superiority or full-package acceptance claim.
Zero runtime dependencies is statically preserved at preparation source only.
Neither current runtime coverage nor deployed-provider behavior was measured.
Current candidate cleanup-contract/runtime membership awaits root's immutable
source and is not inferred from the preparation source.

Original fixture bytes, foreign source/config/docs/index and native artifacts
remain untouched. Only new files under this verifier's owned directory and the
explicitly assigned `/tmp` handoffs were edited, using `apply_patch`. Owned
commits use explicit paths and `git commit --only`. Read-only preparation faults
(initial Git maxBuffer and a transient zsh PATH-shadowing loop) are retained in
`inputs.json`; neither was a product test failure.
