# Independent table-text review checkpoint

- closed-author311: exit 0; 311 test passes, 0 failures, 0 skipped.
- closed-independent: exit 0; 104 test passes, 0 failures, 0 skipped.
- closed-scoped-types: exit 0; 0 test passes, 0 failures, 0 skipped.
- closed-build: exit 0; 0 test passes, 0 failures, 0 skipped.
- closed-built-replay: exit 0; 0 test passes, 0 failures, 0 skipped.

GNU acceptance remains **70/71**, with one open shared-stdin comm status disagreement. Historical author evidence remains 311/311 plus six built checks and 215/216 GNU observations. The original six built-check script was not supplied; the reviewer public-package replay is separately identified and reuses the 71 existing frozen inputs through both pipelines and VFS redirection, without adding native corpus breadth.

Four isolated mutation controls are killed by semantic assertions, including three Buffer-reuse command failures. No new production defect or source repair was confirmed. Source and existing tests were never edited by this reviewer. A no-test selector in the initial borrowed-buffer control is retained, not counted as a successful kill.

Snapshot input drift during validation: 0. Concurrent live-tree drift during validation: 0. Exact maps/deltas, Node identity, oracle binary/archive/manual hashes, commands, logs and closure text are archived. This is copied-worktree evidence, not clean committed-HEAD validation.

All builds emit only inside the isolated /tmp snapshot. Other TypeScript checks use --noEmit. No whole-repository test run, full diff suite, native product fallback, runtime dependencies or production changes.

## Reproduction and artifact scope

The archived scripts show exact commands and assertions. The tools script uses the fixed requested repository root and an owned /tmp work directory; choose a fresh work directory before repeating. Run tools with snapshot audit, then mutations; acceptance requires the explicit fixer closure and creates snapshot closed. The built replay script is copied to that snapshot root so public package self-resolution uses its isolated dist. The original six-check script is unavailable and must not be inferred from the replay.

Initial and final mutation baselines are 108 tests (71 product fixture characterizations, one complete native recheck, 36 author contract tests), not 108 distinct native fixtures. Final independent acceptance is separate. Empty test-file pass entries under name filtering are not extra semantic cases; mutation kills are the named ERR_ASSERTION failures.

# Readonly audit findings

The frozen corpus has 71 ordered input objects: 23 explicit edges and 48
deterministic seeded entries, 16 per utility. JSON hashes bind each exact input
to its native row; corpus.test.ts also compares each object with cases.ts.
capture.ts runs native independently of product and stores status, stdout hex,
stderr hex and file bytes. This is a small fixed corpus, not broad random proof.

Native runs invoke the pinned executable directly, not a host shell or product
fallback; LC_ALL=C is explicit. Native fixtures include a sentinel and namespace
assertions. Product rows execute actual Shell pipelines (cat input | utility),
with quoted literal argv and memory VFS bytes plus namespace preservation.
The original shared-stdin case additionally records actual VFS redirection.
No remote/provider coverage is established by these memory-only rows.

The shared comm case deliberately characterizes status 0 versus GNU status 1
and EBADF; it must be reported as 70/71 native parity, despite a passing test.
Ordinary product stderr is only checked for presence against the native row;
this is weaker than asserting diagnostic meaning/path or exact GNU wording.
Frozen native rechecks compare complete rows including exact stderr hex.

Existing edges exercise repeated '-' with a shared cursor, empty records and
delimiters, NUL separators, invalid UTF-8 bytes, CR/newline data, C byte ordering,
order-mode inversions, duplicate comm multiplicity, join headers/outer fields,
and the existing 35-by-31 Cartesian join. No extra native cases were added.

Current ByteSource is AsyncIterable<Uint8Array>, with no permanent chunk
ownership promise. readBytes forwards producer chunks; collectBytes and the
table RecordReader copy retained bytes. Reusing a producer Buffer only after
next() is requested is a valid test here; arbitrary concurrent mutation while
a yielded chunk is being consumed would not be established by these tests.
The original Buffer.slice regression is already fixed; isolated reversion is a
control, not a newly discovered production defect.

Author contract coverage includes all named quotas, per-command pending reads,
producer failures, exact cancellation reasons, one-byte invalid data and reused
Buffers, plus paste backpressure/EPIPE/readFile fallback and bounded join output.
The current independent 32 tests extend per-command blocked sink, cooperative
VFS stat cancellation, quotas, repeated cursor starts/closes and producer reuse.
These do not prove cancellation of uncooperative host work, every async boundary,
every quota boundary value, all remote adapters, all shell syntax, or full GNU
option coverage. Apple behavior is separate and is not an acceptance oracle.

Four reviewer mutations independently fail actual semantic assertions in an
isolated copy. Source is restored between each; unmutated 108-test baseline
passes again. Initial borrowed-buffer selector matched no tests and is retained
as a reviewer harness mistake, not a killed mutation or production observation.
The corrected selector rejects Buffer.slice in all three original author cases.
