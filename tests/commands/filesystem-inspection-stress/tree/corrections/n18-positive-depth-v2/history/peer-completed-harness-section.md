## Completed harness correction verdicts

- **N18 HOLD.** Exact additive diff is clean, but the actual helper accepts
  `tree: -L failed; width must be between 1 and 256\n`: relevance is checked per
  line, then any constraint on that line is accepted. It also accepts
  `tree: -L must be positive\nvalid range: 0..256\n` because the contradictory
  second line is filtered out. Both were reproduced with the actual helper on
  finite mock bytes. Bind constraints to the correct subject and reject
  contradictory bounds across the diagnostic; preserve current evidence.
- **F29 HOLD.** Signal presence/output/readFile checks remain, but `aborted=false`
  and `reason=undefined` are tested after successful execution. A valid composed
  FS signal active at call time may be aborted by successful resource cleanup
  while the caller remains active. The exact extracted assertion block rejects
  that mock lifecycle. Snapshot liveness at FS entry, not after settlement; keep
  reason propagation checks in F33/F34. No product change to remove composition.
- **F33 GO, F34 GO**, scoped to additive predicate/evidence acceptance only.
  Exact caller rejection identity, FS `.aborted` and exact `.reason`, and return
  count1 remain. Raw records show pending-read rejection injected in both;
  F34 additionally injects pending-return rejection. Injections precede the
  two-turn empty-unhandled check and final gate release. Deferred mocks have no
  catch; telemetry adds no promise handlers. This does not certify unlimited
  future host errors, new source safety, release readiness or other cases.

The old runner is exactly transformed by two replacements, then eight telemetry
replacements; no other case assertion changed. Verified285 original file
publication entries,37 correction entries and25 recorded loaded-module hashes.
Verified35 tree correction entries and its exact two-edit inverse derivation.
Earlier independent verification covered316 tree original entries and54 file
sealed artifacts; original manifest/catalog hashes still match. Original history
copies retain original runner hashes. No initial failure was rewritten.

Both reviewers executed only the authorized old frozen cases: tree1 + file3.
This peer executed zero product cases. Tree initial38 remains30pass/2fail/
3unsupported/3characterizations; N16 profile and N18 native status/text difference
remain non-parity. Initial native lane12match/5mismatch/3unsupported is unchanged.
Tree correction's claimed31 semantic passes includes one predicate now on HOLD.
File initial40 remains35pass/3fail/2backend-limitations; adjudicated31pass/
4native-conflicts/3harness-defects/2backend-limitations. Its optional34pass mixed
index is not independently approved wholesale because F29 remains on HOLD.
File semantic80/80 and machine-exact50/60 are reused, not rerun. F30/F31 stay
characterizations; unsupported0; PE/Wasm stay unexecuted independent specimens.
Both corrections explicitly reuse37 old cases each, not a full38/full40 run.
SQLite canonical MIME is a separate source delta and was not executed here.

