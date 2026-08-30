# HARN-SIGNAL-001 v2: F29 entry-time signal observation

**Prepared for peer review; zero product/native executions.** The author TEXT
safety fix and a later frozen full-40 run remain separate root authorizations.

## Peer finding and exact correction

The completed `SAFETY_FINDINGS.md` section grants scoped GO to F33/F34 but holds
F29: successful resource cleanup can abort a composed FS signal after a valid
call. Its v1 post-settlement liveness assertions reject that legitimate lifecycle.
The exact peer report, countercheck source, original raw countercheck output and
F29 failure observation are preserved under `peer/`, with hashes in
`v2-correction.json`. They were not rewritten or rerun as a product test.

Only F29 changes in v2:

- Immediately on each FS method entry, before forwarding the call, capture signal
  presence, actual `AbortSignal` type, aborted state and reason value. Snapshots
  retain no live signal reference; successful cleanup cannot change those values.
- Assert the captured entry state is an actual, active/unaborted signal with an
  undefined reason. Do not assert signal object identity or post-settlement liveness.
- Preserve exact PNG stdout, successful status, empty stderr, readFile-use checks,
  the original fixture's whole-file `maxBytes` guard, forwarded options and trace.
  Capture `maxBytesAtEntry` too. No new exact cap value or family-limit policy is
  invented; the existing F29 did not separately mandate a particular guard value.

The wrapper returns the original FS promise directly through `Reflect.apply`.
No `then`, `catch`, abort listener or promise handler is added. The observation-only
diff and assertion-time diff are separate and reversible. The intermediate
observation-only runner deliberately retains v1 assertions; only `runner/v2-runner.mjs`
contains the complete proposed correction.

All source text before and after the F29 block is byte-identical to v1, including
F33/F34 propagation, exact caller reason, return count, genuine late injections,
two-turn unhandled checks and their telemetry. Native fixtures, MIME/human/status
expectations, other cases and original helper implementations are unchanged.

## Nonproduct controls only

Six bounded harness checks pass using the exact extracted F29 callback with finite
synthetic FS/invocation mocks. No complete runner, candidate, classifier, Shell or
native utility is imported or called.

- Positive lifecycle: active composed signal at both FS entries; successful cleanup
  aborts it before settlement while the caller stays active. V1 rejects; v2 accepts.
- Positive baseline: signal stays active; original promise/options identities and
  `maxBytes=65536` forwarding are verified by the mocks.
- Negative entry controls: already aborted, missing signal, invalid active-signal
  reason, and non-`AbortSignal` duck object are rejected. Invalid-state mocks are
  deliberate negative controls, not assertions of conforming provider behavior.
- Existing outcome controls still reject wrong PNG output, nonzero status, nonempty
  stderr, omitted readFile use and a too-small whole-file `maxBytes` guard.

An initial mock driver omitted the extracted callback's `fileEntry` helper, yielding
2 passing structural checks and 4 wiring failures before those lifecycle checks
could run. Its exact source, TAP output and empty observations are retained. Only
mock dependency wiring/diagnostics were corrected; neither v2 runner nor its
predicates changed. The corrected six-check run and all raw observations are retained.

## History and review boundary

Original 54 sealed artifacts, original preseal, initial raw-40 publication (285
entries), v1 corrected-three publication (37 entries), and peer F29 failure remain
preserved. Initial raw counts remain **35 pass, 3 fail, 2 backend limitations**.

V1's old-source three-case run is historical, not a full-40 run. Peer scoped GO for
F33/F34 is unchanged; F29 v2 is awaiting peer review and has no new product result.
Do not promote mock success into product acceptance, a newly green mixed index,
author-fixed source approval, or full-40/native parity evidence.

Exact old/new runner hashes, replacement strings/reasons and history hashes are
in `v2-correction.json`; separate diffs and old runner copies are preserved. Raw
nonproduct evidence and integrity/process records are in `evidence/`.
`PUBLICATION.json` seals only this additive v2 bundle. Original manifests are intact.

Root detail: `/tmp/safe-bash-file-harness-v2-detail.txt`.
No source/default/root edits, native/product reruns, staging or commit. Stop for peer.
