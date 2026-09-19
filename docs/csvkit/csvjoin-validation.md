# csvjoin validation, September 18 2026

The literal `csvjoin` engine now lives in its command descriptor file and uses
the independently inferred typed-table reader. It remains one of the fourteen
original opt-in safe-bash executables; CLI and SDK use that same engine. This
scope does not implement or qualify every other csvkit executable.

The owned development environment `out/csvjoin-reference` replayed the
CPython 3.14.2 hash-locked requirements: csvkit 2.2.0, Agate 1.14.2,
SQLAlchemy 2.0.54 and the declared dependency closure. Installed csvjoin source
SHA-256 `197d34b3ebb611a6ac38cdbac60bb4e62df2ed16d8844d375554faf5ca7affd1`
matches the authenticated archive manifest. The required PyPI archive SHA-256
is `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The frozen reference profile supplies runtime, locale, clock, drivers and
dependency identities. Captures used LC_ALL=C, LANG=C, TZ=UTC,
PYTHONIOENCODING=utf-8, COLUMNS=80, LINES=24, PATH=/usr/bin:/bin and non-TTY
pipes. `csvjoin-reference.json` retains ten additional exact original
stdout/stderr/status observations with warning deployment identity. Existing
`join-operation-reference.json` supplies twelve baseline observations.
Canonical tests only use static observations and injected in-memory inputs;
they create no host files and run no native/Python/network/database programs.

TDD first reproduced typed singleton serialization and Boolean/Decimal key
equality returning status 78. The independent stress agent reproduced six
failures in twelve initial cases. A subsequent original differential reproduced
repeated identical input-header warnings; invocation-local warning deduplication
fixed it, and its canonical regression matches exact stderr. The full csvkit
workspace tests cover the shared normalizer's other consumers too. Key tests
also cover Decimal scale/signed zero/large integers, NaN inequality, date versus
datetime identity, aware instants, durations, duplicate and null multiplicity,
outer key retention and first-key null propagation, right reverse traversal,
selector offset, input-specific selectors and left/right-over-outer precedence.
The inherited --zero discrepancy is intentional source compatibility.

Final checks:

- Maintained csvkit workspace test: 43 files, 1,917 passed, one existing skipped
  and six existing TODOs. The skipped/TODO cases remain unqualified.
- Maintained csvkit workspace lint/source-and-test TypeScript checks passed.
- Maintained explicit csvkit build closure and safe-bash build closure passed;
  the latter builds ten declared dependencies/workspaces and suffix stages.
- Focused actual safe-bash Shell tests: 25 passed, comprising 17 independent
  csvjoin stress tests and eight shared csvkit integration tests. Inputs remain
  unchanged, output backpressure is awaited, reusable byte buffers are retained,
  and cancellation cooperatively closes registered readers.
- Eleven novel independent development reference cases matched exact bytes and
  status. Collision-case warning suppression was explicitly injected; root's
  separate frozen cases verify unsuppressed warning text and repeated warnings.
- Exact safe-bash test discovery registration suite: 109 passed. Scoped ESLint
  for the stress test and integration registration passed.
- Maintained safe-bash type check passed source/tests, 26 current consumer
  groups and expected negative diagnostics. This is compile acceptance only.

Two newly authored guard tests initially failed because the SDK test omitted
input_paths and the input-row budget included headers. The test inputs were
corrected to exercise actual SDK named inputs and Cartesian output expansion;
the backpressure rendezvous now fails immediately on early command completion.
No timeout was increased and no product budget was weakened.

The maintained generic screenshot route rendered actual built Shell inner,
right and full-outer examples. Visual inspection confirmed legible commands,
correct ordering and retained full-outer keys without clipping. The generic
route is appropriate because csvjoin is a Shell plugin, not a poe-code CLI
subcommand. Only owned temporary reference/visual artifacts were purged.

All inputs and intermediate joins intentionally materialize. Aggregate input,
row, column, retained-byte, output and work budgets bound this behavior;
Cartesian expansion refuses before CSV stdout is emitted. This is not a
streaming join or a measured RSS bound. No file/database writes, network or
product subprocess/Python fallback are introduced.

Remaining explicit blockers include shared unsupported numeric reader quoting,
unbound codecs/compression/warning/verbose traceback identities and unsupported
locale/temporal hypotheses. Exhaustive dialect/locale/date grammar, the second
CPython profile, native signals/TTY, uncooperative host cancellation and complete
fourteen-command parity are unmeasured. No full repository test/lint, release or
deployed-provider acceptance is claimed. Source opening precedence was inspected
and checked against the reference: missing files plus invalid join flags still
produce the join-argument errors, because the original input wrapper is lazy.
No README content, staging, commits, pushes or publication were performed.
