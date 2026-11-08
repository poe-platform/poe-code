# Pre-execution body observations (not runtime results)

The immutable candidate is a component and unapplied textual overlay. Exact
content hashes and Git blob provenance are in PRESEAL.json. No source-policy
or builtin-capability review is duplicated here.

## Allocation and accounting

- records.mjs:11-65 bounds emitted UTF-8 including newline, visits, and depth.
  String length and escaped UTF-8 size are checked before JSON.stringify at32.
  It still enumerates all descriptors and Object.values at44-45, then
  Object.entries at54 before recursively enforcing visit counts. These
  intermediate arrays/descriptor objects are not bounded by output bytes.
  fragments.join plus Buffer.from at65 coexist with strings/input; the32MiB
  logical cap is neither peak heap nor RSS. A configured small cap is tested;
  only one default-cap oversize input is attempted, immediately length-refused.
- records.mjs:74-100 charges attempted bytes before open; duplicates and failed
  opens retain conservative charge. write/close failures retain presence even
  for0/null/undefined. This is not exact allocated/durable disk usage.
- records.mjs:102-110 serializes the whole logical document, writes parts, then
  writes the descriptor. A partial descriptor can physically exist on failure;
  absence of a returned reference/authenticated readable result, not filesystem
  rollback, is the acceptance invariant. Total quota includes descriptor bytes.
- records.mjs:115-152 authenticates bounded physical records and individual
  parts; all part buffers plus concatenated logical bytes plus parsed JSON may
  coexist. Smaller caller logical caps do not avoid reading the first bounded
  physical record. No allocation-pressure experiment is authorized.
- records.mjs:68-73 resets accounting per createStore instance and does not scan
  existing files. This matches the explicitly coordinator-owned-store scope,
  not whole-run evidence accounting; D14 makes this boundary observable.

## Publication and assessment

- publisher.mjs:23-53 preserves selected primary presence, separately records
  publication/output failures and attempts one bounded stdout plus one bounded
  stderr fallback. A persisted accepted RESULT can precede a terminal failure;
  artifact-only acceptance is invalid by design.
- publisher.mjs:25-34 calls ledger.summary, examines rows and maps children
  outside its persistence/output try blocks. Exceptions before this body and
  during these preparations need an outer successor reporting boundary.
- publisher.mjs:56-62 checks closed exit0, retained stdout size, empty stderr,
  selected terminal fields and authenticated artifact agreement. It does not
  inspect receipt.captureBytes, failures, signals or natural. D13 tests a
  missing terminal failures array; S20 tests an actual supervisor truncation
  receipt whose retained prefix still parses. Expectations are fixed as refusal,
  not adjusted to the implementation if either exposes an acceptance defect.
- assessTerminal is not an independent semantic authority: it relies on the
  coordinator's status and trusted ledger. It does not individually qualify
  every child exit/report; the unpatched coordinator does that at88-91.

## Inherited boundaries that are not silently waived

- executor-v6/coordinator.mjs:15-26 top-level reads, packet/tool checks;31-43
  authorization/lock/run-directory setup;54 initial AUTHORIZATION save all lie
  outside the workflow try at94-141. The overlay does not add an outer catch.
- coordinator.mjs:142-149 creates finished/tail/launch accounting/planned
  operation/status fields after that catch, also outside publication protection.
  In particular cohort expected uses schedule.rows at143, whereas the earlier
  workflow accepts schedule.rows ?? schedule.executions at122. This is a
  source-qualified latent tail exception if the fallback representation is used,
  not a claim that the frozen actual schedule failed here. Actual schedule use
  and fresh authenticated interfaces require full successor qualification.
- coordinator.mjs:68-75 integrity, operation selection and order run before
  launchTracked enrollment but before native child acquisition. launchTracked
  enrolls at63, prepares at66, marks starting at69, and passes attach to the
  supervisor at70. supervisor.mjs:32-34 spawns and immediately attaches the
  exact handle; listeners follow the callback. Its catch handles callback
  failure with signals, but the spawn-to-attach boundary cannot be described
  as pre-acquisition handle enrollment. Known acquired receipt-persistence
  failure is tested; untested acquisition-event races are not certified.
- launch-ledger.mjs:33-52 retains known handles/receipts, emergency TERM/KILL
  work and closure; supervisor.mjs:58 clears its registered clocks. Successful
  complete/persist alone is not a semantic child pass; settled checks failures,
  signals and exit0. S18 uses the actual supervisor and assessor for exit7.
- coordinator.mjs:42 writes a grant lock outside store; worker.mjs:36 and
  synthetic-worker.mjs:31 write operation claims directly, also outside store.
  projection.mjs re-exports executor-v5 projection, whose83-90/115-136 writes
  staged views directly. Staged package bytes need an explicitly classified
  resource budget, not automatic evidence charging or exclusion. These paths
  are only read, never executed/materialized in this review.
- Inherited executor-v3 transport encodes JSON to a Buffer before its262144
  cumulative refusal at12-15; this component does not fix upstream producer
  allocation. Source helpers and immutable history are not modified.

Fresh recipe/reader/worker/authorization sealing, aggregate evidence accounting,
pre-report/tail exception containment, independently qualified actual engine
composition, separate builtin adjudication and a fresh explicit root grant
remain required. The consumed V6 grant authorizes nothing here.
