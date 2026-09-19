# Additional user lifecycle validation

This bounded pass follows docs/plans/csvkit-user-edge-qa.md. It does not complete
the original suite or establish exhaustive edge coverage.

Two concrete issues were reproduced with failing in-memory regressions before
product changes:

- SDK sparse arrays passed `Array.some` validation because holes are skipped.
  The engine now rejects holes/undefined entries in positional, repeated-text
  and option-pair sequences before output, cleanup registration or acquisition.
  The regression checks three sequence types and empty output/effects. This is
  SDK admission evidence, not a native csvkit observation.
- A different agent exercised enrolled stdout closure during pending injected
  database row iteration. Cooperative cleanup returned the iterator and drained
  the result/session, but the adapter replaced EPIPE with a domain
  `invocation already closed` refusal. After draining cleanup, the adapter now
  checks caller cancellation followed by owned-output cancellation before
  selecting the domain outcome. The failing regression now preserves the exact
  EPIPE object and leaves the caller signal unchanged. A second test confirms
  cancelled pending connection acquisition is awaited and rollback/close each
  occur exactly once. Mock drivers qualify lifecycle behavior only.

Maintained domain tests pass 1,336 tests with five explicit output-encoding TODOs.
Domain ESLint and product/test typechecks pass. Selected maintained domain and
safe-bash build closures pass (one and ten workspace builds respectively).
The focused actual-Shell suite passes 80/80 tests, with no skips or TODOs.
Focused ESLint passes for all changed source/test files.
Maintained safe-bash source/test and public-consumer typechecks pass, including
all 26 current consumer groups and three negative controls. The first invocation
overlapped regeneration of build artifacts and returned `typecheck-failed`;
the sequential rerun after the completed build returned
`typecheck-passed-not-runtime-acceptance`. The first invocation is not credited
as a pass, and typechecking does not qualify database or runtime behavior.

A compiled public Shell/plugin invocation uses an in-memory file and explicit
codec/locale/clock/terminal bindings. `csvcut -c value,name /input.csv` emits
`value,name\n42,Alice\n`; `sql2csv --add-bom` reports the existing argparse
rejection with status 2 and no BOM. The rendered terminal screenshot was viewed:
headers, rows, aligned usage and the complete error are readable without clipping.
The first manual smoke attempt omitted required bindings; a later attempt omitted
printf registration. These were corrected in the smoke setup, without product
changes or counting either failed setup as a pass.
Owned temporary screenshot, Shell TAP output and typecheck log were removed
after reducing their results here.

The earlier native reference cohorts are replayed by maintained tests; no fresh
native operation measurement was made in this pass. Remaining Agate, regex,
workbook/DBF, compression, real database and interactive blockers remain in
implementation-status.md, including non-UTF-8 output-profile divergences.
No full repository runtime pass is claimed. README, unrelated edits and staging
are preserved; no commit, push or publication was performed.
