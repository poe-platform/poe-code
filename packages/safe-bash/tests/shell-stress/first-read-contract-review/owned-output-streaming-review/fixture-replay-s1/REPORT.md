# Independent fixture-only S1 replay: strict acceptance remains incomplete

One bounded corrected execution, no source fixes, no second execution correction
round. This qualifies only the frozen TEMP S1 candidate and enumerated profiles.
It grants no live-source/API/rootfile changes, production/release permission,
superiority, universal Bash/native parity, or 72-hour completion claim.

## Results and immutable denominators

| Cohort | PASS | FAIL | BLOCKED | UNRUN | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| First independent parameters, preserved | 9 | 8 | 3 | 0 | 20 |
| Corrected parameters | 17 | 0 | 3 | 0 | 20 |
| First independent logical cases, preserved | 3 | 7 | 2 | 0 | 12 |
| Corrected logical cases | 10 | 0 | 2 | 0 | 12 |
| Exact original-five replay, separate | 1 | 4 | 0 | 0 | 5 |

Corrected acceptance has no inner/outer timeouts. The original first corpus's
two inner TIMEOUT observations remain in its raw data; its frozen supervisor
aggregated them as FAIL. The original-five local1200ms deadline remains a
historical FAIL, not a newly waived pass. No outer3000ms bound fired here.

All five new explicit-opt-in positives reach their actual IO scenarios and pass.
All three S06 streaming/reuse/backpressure records and both S07 nested-owner
records pass. S08 has one PASS and two strict BLOCKED records; S11 has two PASS
and one strict BLOCKED record. S09, S10 and both S12 records pass. Full exact
20-row original/corrected mapping is in `round1/results.json`.

Original-five results remain local FAIL, S3 PASS, WebDAV FAIL, curl-body FAIL,
curl-headers FAIL. Local retains its exact1200ms deadline; the three remote
failures retain their old whole-stage-abort assertion at probe line103. None
is rewritten as an operation-close assertion. These are not the new five.
The prior independent57/57+9/9 remain historical, unchanged and **not rerun**;
C9 remains synthetic. No new native or rejected-v2 negative-control execution.

## Identity, authority and prereplay freeze

Root's direct assignment reports author17223/prep93709/binder82828/executor24323
all actually EXIT0. This leaf neither delegated nor claimed to observe those exits.
Author seal `c1985fd5ef365312a098148528cee517064cfaa9` and first execution
`c8178bb482e49d824cc96cccc781b81ef4be9014` are immutable. Criteria, prep and binder
commits remain `722c62f8a8e0795dc2c72509cc012a6017217c0d`,
`9d29cf908efabb7d8d840c62e969ef7bae14bcdb`, and
`b3d09429de0af798663a5a18839e8b15f132a1f8`.

Prereplay commit: `9e6c5e2394d5d36df42529d74d1dd21301ddeab6`, 85 new owned files.
Its plan, all97 scenario assertion expressions/text/order, frozen12/20 mapping,
and existing17 qualified/3 blocked public profiles remain unchanged after replay.
Prelude provenance/environment checks alone differ as disclosed in the patch.
That commit precedes the first corrected product replay at
2026-08-27T11:56:53.345Z. Candidate import qualification is separately recorded
before replay; it imports safe facade/helper modules, not the positive probes.

| Identity | Count | SHA-256 |
| --- | ---: | --- |
| Source manifest | 213 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` |
| Test manifest | 15 | `dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c` |
| Compiled manifest | 708 | `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f` |
| Tested manifest | — | `4e84fe7dc3a762654a6bb1865f5f73f259fc61f8aa9bcabb250663ff7c9645f9` |
| Corrected driver | — | `28c090b7b2cfa0a6d9cb1f5c1837ca3d0726734dea630ab4557beb0a9da8bd82` |
| Corrected config | — | `008fa2c2e0ca81f916e1e14d7d335061e6b9e898e09b8d3f62ccf1b51d7b1ac5` |
| Prereplay seal | — | `03ba6edd32660c03352a8f939e52eba8c87669c5d3ff3a441f872c506769316d` |

Reused read-only candidate:
`/tmp/safe-bash-owned-output-streaming-execution-restore-J93UJO/candidate`.
No build or source fallback occurred. Before/after checks cover940 candidate
files (213+15+708+4 configs), all358 compiler inputs, original tools/patches,
217 prior evidence files,218 live-source/root files,19 prereplay artifacts,
163 import-closure modules, and298 current tool files. Exact original source
patch identities are recorded in `round1/authentication-after.json`.
The pinned tested-manifest hash also matches the frozen before-capture entry.
No files in the85-file prereplay commit changed afterward.

**Concurrent root qualification:** the successful after-record check found all218
live-source/root files unchanged. At the later final-seal check, foreign edits
to live `package.json` and `tsconfig.json` were detected. The first failed sealing
assertion is preserved, followed by exact before/current bytes, hashes and diffs
in `round1/foreign-*`. These root files are not this leaf's ownership; they were
not reverted or edited. Live src files, the sealed candidate's four configs,
all213/15/708 candidate inputs and authenticated tools/patches still match.
No product replay occurred after detection. This evidence does not certify the
concurrently changing live root configuration.

## The two demonstrated fixture defects

### Missing historical internal-module facade

The exact historical remote helper imports the WebDAV mock, whose runtime import
of `src/fs/webdav/resource-id.js` was absent from the old facade. Consequently
the original five positives never reached their IO scenarios. The old config's
premature complete-closure assertion is **retracted, not erased**; its bytes,
failure logs and later first-executor qualification are preserved under `original/`.

The only new module facade forwards that internal export to the SAME candidate's
compiled `dist/fs/webdav/resource-id.js`. The public facade likewise forwards
to that candidate's `dist/index.js`. Import qualification proves public Shell
and internal registerOwnedResourceResponse function identities match direct
compiled imports, avoiding separate resource registries or fake filesystems.
The selected helper/probe runtime graph has163 modules and469 edges; every
runtime import resolves to exact historical TS, the compiled candidate or a
Node builtin. Erased type-only imports are classified, not runtime-loaded.
All19 historical input files retain exact original bytes. Dormant historical
snapshot scripts are reference data, not silently executed against live source.
`artifacts/import-closure-proof.json` contains exact module/facade hashes and edges.
This is selected runtime closure, not a claim that every historical test ran.

### Competing request listeners lost the initial body bytes

The old server callback immediately installed a counting `data` listener, then
deferred the real handler through `Promise.resolve().then(...)`. That early
listener put the request in flowing mode; S06's later async iterator and S07's
later first-data listener could miss bytes already emitted to the guard.

Separate bounded fixture-only instrumentation extracts the exact old helper.
Its event0 is the guard receiving19 bytes with one data listener; event1 is
entry into the late handler. Its full-body collector sees zero bytes. The
corrected helper captures the same19 bytes with one data observer installed
before the deferred handler; both witness servers fully close. This is an
event-order demonstration, not an inference from the product's failure, and
adds no acceptance case. Exact witness source/events are in `artifacts/`.

The corrected driver installs one bounded observer synchronously, publishes
first-data immediately, copies retained fragments, and separately resolves full
body on end. It never waits for EOF before publishing first-data. S06 observes
11 bytes with EOF false, then unlocks EOF and verifies exact
`before-eof\nafter-observation\n`; reused-buffer upload verifies `AAAABBBB` even
after producer-finalization mutation. The unchanged stalled-sink test records
one read and zero finalizations while its awaited write is pending.
Server full-body capture already existed in the old test: this repair removes
the competing listener, not streaming or exact-payload/backpressure checks.
There is no product/input prebuffering, retry-to-green or changed acceptance.

## Strict blockers: actual observations, not promoted passes

The unchanged first `PRE-RUN.md` profiles remain authoritative. The three
diagnostic records report `OBSERVED_WITHOUT_STRICT_BINDING`, not acceptance.

### S08 first and third: required work versus closed stdout

- Both body files contain exactly `required-body\n`.
- The third record's header file contains `HTTP/1.1 200 OK`, Content-Length14,
  and `X-Binding: required-header`; exact CRLF bytes and dynamic Date are in raw data.
- Independent file text is exactly `independent-file\n`; parent stderr is
  exactly `independent-stderr\n`. Nested curl stderr is empty.
- Nested curl returns141; parent returns0. Stage/caller signals stay live.
  Borrowed owner is live with zero operation-time returns, followed by one
  legitimate normal-owner return after finalization.
- Stdout writeout attempts and deliveries are BOTH empty. No stdout writeout
  has been routed to stderr, and missing abort alone is not retained-work success.

The second S08 record is independently PASS under its prequalified profile:
required header file retained, nested141/parent0 and independent file/stderr
effects present; its body destination is stdout and no writeout is requested.

The frozen criterion requires positive retained writeout work. The proposed
contract instead says stdout header/body/writeout publication is separately
scoped, while required -o/-D work has an independent lifetime. The observed
files/header/stderr do not supply the missing positive writeout witness.
Root must decide what observable required writeout work means after stdout
closure, without requiring impossible closed-sink delivery or redirecting it.
Any future binding revision needs new authorization; these records stay BLOCKED.

### S11 IO first: thrown failure versus an operation abort reason

The exact frozen script remains `set -o pipefail; precedence-probe | cat`.
The event journal records controlled EIO delivered before caller.abort(0).
Public result is `{kind:"error",error:0}`. All actual command-stage signals
abort with reason0; the explicit operation snapshot remains un-aborted with
no abort reason (serialized null), after normal close. Cleanup runs once and
settles; there is no unhandled late rejection. No buffered ShellResult is
returned on this rejection, so stdout/stderr content is not invented.

Frozen wording says cleanup must not mask an established failure. The proposed
contract says explicit finally-close can replace a prior throw and is not an
exception-precedence combinator; its first-reason rule applies to operation
abort reasons, not every thrown command error. The fixture's finally starts
normal close before the later caller cancellation. Root must resolve the
intended operation-reason/cleanup wording separately from caller-public0.
This observation neither establishes a source bug nor fills the missing profile.
Caller-first and standalone reason0 records pass their unchanged profiles.

## Environment, closure and limits

Current tools: Node v22.22.2, tsx4.23.12, esbuild0.28.2, TypeScript5.9.3.
Local package/binary hashes and @esbuild/darwin-arm64 identity are captured.
Before importing tsx, test/helper children receive `TSX_DISABLE_CACHE=1` and
explicit task TMPDIR/TMP/TEMP/TSX_CACHE_DIR. The driver enforces the setting
and passes it to every record child; original-five uses the same environment.
Task temp contents are empty afterward. This is explicit loader/temp isolation,
not a syscall-wide audit or retrospective certification of the first executor's
ambient-cache footprint. Its scope uncertainty remains preserved; no ambient
historical cache was searched, altered or cleaned.

All20 acceptance and5 original-record children terminate without signal and are reaped;
their process groups are absent at final check. The acceptance/history
supervisors exit1 for intentional non-all-PASS summaries, without signal or
hard timeout; the import qualifier exits0. Its group and both supervisor groups
are also absent. All20 acceptance fixtures and both fixture-only witnesses
report zero timers/sockets/tasks/children and no cleanup failures. S12 explicitly
releases/rejects its opaque pending read; no universal preemption/drain claim.
No poller, SIGSTOP, install, dependency, rootdist/global-typing/full-suite run.

Two preparation-script errors and one failed no-change apply_patch attempt are
preserved in `PREPARATION-ERRORS.md` and raw artifacts. They precede product
replay; only ONE fixture execution correction round was used. Source-fix count0
means no product source was changed; source-bug count0 means none established,
not proof that no defects exist. No old assertion/report/fixture was repaired
in place. Concurrent foreign work/index/native artifacts are excluded from
both leaf commits. Root must observe this leaf's actual normal exit separately.
