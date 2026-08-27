# Bounded comparison runner: preparation only, revision2

Status: **WAITING_ROOT**. No candidate freeze, comparison, native workload,
loopback service, timing, new du work, stage or commit is authorized by this work.
The known planned additions are tree and file, not unspecified names. Neither
their actual frozen inclusion nor candidate qualification is inferred from68-to70
arithmetic or moving HEAD. This leaf owns only `runner/**` and its `/tmp` evidence.

## Delivered boundary

- `prepare.mjs`: read-only PREPARE/PREFLIGHT CLI. There is no executor, engine
  import, process/worker spawn, network client/server, native invocation or timer.
- `gate.mjs`: bounded manifest structure, a hash-bound preparation-only ROOT
  coordination receipt, file-hash receipts and selected cohort bindings. No keys,
  signatures or `comparisonApproved` requirement. Accepted preparation still
  returns `PREPARED_EXECUTION_DISABLED`, never a score or execution approval.
- `reader.mjs`: explicit regular-file reads under this repository or `/tmp`
  (canonical `/private/tmp` on this host), chunked hashing, no-follow final opens,
  bounded bytes/count and before/after identity/size/time checks. No directory
  crawling, extraction, installation, executing, executable lookup or ambient
  credential access. OS metadata/read stalls are not a hard wall-time guarantee;
  this is a byte-bounded local reader, not the future process watchdog.
- `lifecycle-model.mjs`: pure transcript/deadline checks and a mock-clock fallback
  schedule. It sends **zero real signals** and proves no real process lifecycle.
- `selfcheck.mjs`: deterministic mock coordination receipts, data and adverse
  lifecycle transcripts. Its only executable-looking fixture is classified
  `mock-not-an-engine.mjs.data`, read as bytes, never imported. This is not a
  product test or a source-inventory waiver.

No dependencies or root/package changes. No artifacts are written by the CLI;
retain stdout/stderr under a new attempt path rather than replacing old evidence.

Historical preparation may select just original224, aligned224 or breadth without
inventing a current candidate freeze, including new24 or supplying new native
oracles. Proposed holdout expectations may remain null; their preparation is not
measurement. Evidence roles may share one hash-bound document with explicit,
distinct selectors. Candidate preparation retains independent inventory and
different packed-review requirements; historical preparation does not qualify a
candidate. See `INTERFACES.md` for the two explicit scopes.

## Commands available now

Run from `/Users/kjopek/Workspace/safe-bash` with Node >=22:

```sh
node benchmarks/reports/current-comparison-20260827/runner/prepare.mjs PREPARE
node benchmarks/reports/current-comparison-20260827/runner/prepare.mjs PREFLIGHT
node benchmarks/reports/current-comparison-20260827/runner/selfcheck.mjs
```

The first two intentionally exit **2**, report `WAITING_ROOT`, `score: null`,
`engineCalls: 0` and all execution counters zero. The mock checks exit 0 only for
their own checks, not for product correctness. CLI malformed inputs exit 1.
`EXECUTE`, `RUN`, `TIMING` and any `--allow-execute` option are rejected.

Once ROOT supplies the selected preparation inputs, this command remains offline and
cannot run a product:

```sh
node benchmarks/reports/current-comparison-20260827/runner/prepare.mjs PREFLIGHT \
  --manifest /tmp/root-selected-preparation-manifest.json \
  --root-receipt /tmp/root-preparation-receipt.json \
  --root-receipt-sha256 ROOT_SUPPLIED_64_HEX_RECEIPT_SHA256
```

Those paths/digests are **placeholders, not created files or approval**. See
`INTERFACES.md` for the receipt/file contract and its trusted-host limits. ROOT
supplies the receipt hash externally; it binds the exact manifest and selected
artifact hashes/selectors. No execution or all-phase approval is implied. A
self-authored receipt or sibling integrity seal is not ROOT coordination authority.

## Historical sources inspected as text/data

| Evidence | Immutable reference | Reuse boundary |
| --- | --- | --- |
| 224 fairness audit | `245799e7498c849098ca971fe00270112aa5e06e` | `comparison-fairness-20260827/audit/REPORT.md`, four-field assertions, original/aligned controls |
| Published baseline authentication | `010411eff3dd210b9575e061914efccd65c13547` | `published-artifact-authentication/verification/FINAL-REVIEW.md`, package/lock/entry and lifecycle qualifications |
| Breadth author | `849dbf18b1e865c7d12927c11f0e20ba0555c540` | `baseline-only-20260827/coverage-execution/`, all61 primary plus7 diagnostics, failed attempts retained |
| Different breadth reviewer | `e0325b590b593fbe5fd17b2b1b778fe8badb25f0` | `coverage-review/measured/REVIEW.md`, lost-delivery/recovery and leaked-JS cleanup failure |

Paths in that table are relative to `benchmarks/reports/`. Also read, never
imported: `benchmarks/expanded/{recipes,common,engine,session,native,run}.mjs`,
historical `0294afb:benchmarks/expanded/common.mjs`, and breadth case/child/runner
sources. Expanded `run.mjs` has top-level execution and timing; `engine.mjs`
loads products and installs an IPC listener. They are **not safe data imports**.
Original session cleanup can wait without a deadline; its output cap is a text
length approximation. Breadth clears its overall timer on result, waits for child
close after killing, and can retain oversized diagnostic chunks. Do not reuse
these orchestration functions as the new bounded supervisor.

The old 222-or223/224 versus155/224, 54 missing compatible spellings and successful
guest/failed-worker-cleanup result are historical, not current candidate scores.
The baseline authentication established pinned3.4.2 package bytes, not all
transitive publication provenance or universal module evaluation. This task does
not contact a registry or reauthenticate the package. `PROTOCOL.md` preserves
scope, native profiles, byte boundaries, resource failures and separate tables.

## Separate future execution gates

1. ROOT's exact candidate inputs, independent inventory acceptance and different
   packed-review acceptance, each tied to that candidate/pack/consumer inventory.
2. ROOT acceptance of sibling cohort/provenance files and this runner design.
   The sibling holdouts currently have null native expectations, not passes.
3. A separately implemented and reviewed executor, real adversarial lifecycle
   controls and per-engine resource/dispatch verification. No such tests run here.
4. A fresh hash-addressed ROOT execution approval after those checks. Timing
   requires a distinct later approval; no comparison result implies it.

No current superiority, full gate, universal parity, completion or duration claim.

## Additive revision history

Review requests1/3 are addressed here; sibling requests2/4 remain other owners'
work. `revisions/reviewed-v1/RECORD.json` preserves all10 prior runner files as
opaque data, reviewed hashes and initial60/62 plus reviewer62 raw mock histories.
`VALIDATION.md` explicitly records historical v1 checks; `REVISIONS.md` records
the current revision/checks. No prior evidence or failed attempt is erased.
