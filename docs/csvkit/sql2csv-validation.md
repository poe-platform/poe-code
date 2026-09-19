# sql2csv implementation validation

Date: 2026-09-18. The command now lives directly in
`packages/csvkit/src/commands/sql2csv.ts`; the previous query operation was moved
into that file rather than retained as a proxy. The original fourteen executable
names, parser descriptor and explicit Safe Bash command family remain intact.
No product subprocess/Python fallback or ambient capability was added.

The first failing original regression reproduced SDK execution options dropping
`no_parameters=True` while argparse append preserved it. Source defaults are
now retained on both paths, with repeated keys still selecting their last value.
A second failing original differential reproduced status 78 for the measured
first-statement SQLite execution isolation AUTOCOMMIT path. The actual product
WASM/memfs binding now matches native default rollback and autocommitted persisted
DML, without adding command-level begin or commit.

Reference capture authenticated the released archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`, compared installed
sql2csv source bytes with the archive, verified the frozen CPython executable hash,
SQLite version and every frozen non-pip distribution version, and supplied the
profile's C locale/UTC environment. `sql2csv-reference.json` retains 22 native
stdout/stderr/status observations, ordered engine/connection/options/query/close
observations and two before/after database-row observations. Temporary native
query/database files were isolated under out and removed by capture cleanup.
Canonical tests never run these native programs or access a host database.

The command fixtures compare exact channels/status using memfs inputs and injected
measured driver values/diagnostics; driver-error injection qualifies command
handling only. The database-effect tests use the actual fast SQLite WASM engine
and explicitly injected memfs VFS, with no host database files or network.
Independent worker evidence is retained in `sql2csv-stress-validation.md`.

Cleanup is deliberately stronger than native source on errors: registered,
idempotent iterator/result/session release occurs even where native exception
paths escape before connection close/engine dispose. Explicit rollback and result
close are additional effects visible to injected hosts. Borrowed input stream
ownership is preserved; native Python stdin closure is not simulated through an
unavailable host close API. Source observable CSV/query/transaction semantics
remain measured separately from these ownership differences.

Focused uncached verification:

- csvkit maintained workspace unit route: 4,100 passed across 86 files; one existing
  skip and six existing todos remain unqualified.
- csvkit maintained ESLint/source/test typecheck route: passed after repairing a
  possibly-undefined index in the new root-owned fixture test.
- selected csvkit and Safe Bash maintained workspace build closures: passed.
- Safe Bash actual registered-command tests plus lifecycle review: 91 passed,
  including 16 independently authored sql2csv stress cases.
- Safe Bash maintained runner/inventory checks: 536 passed, no skips/todos.
- Safe Bash maintained source/test and authenticated public-consumer typechecks:
  passed.
- Repository-wide maintained ESLint, TypeScript/contracts and workflow lint:
  passed.
- An ad hoc screenshot of actual registered help, duplicate/unnamed result labels,
  ordinary CSV quoting and `-H -l` output was inspected; output is complete and
  readable. No screenshot test or product styling dependency was added.

Other isolation levels, engine isolation settings and isolation changes after
prior queries remain explicit blockers, as do unmeasured external drivers,
unqualified verbose tracebacks and the existing SQL literal/codec/SQLite-build
profile gaps. Successful blocker assertions are not supported-profile passes.
Read `docs/specs/sql2csv.md` and shared SQLite/provider specifications for limits.
No README content, staging, commits, pushes, publication or releases were made.

The uncached default `npm test` broad gate did not pass. Its combined workspace
batch reported these three 5,000ms timeout failures:

- `src/credentials.test.ts`: exposes the credential helpers without the
  application entrypoint.
- `packages/docx/src/workflow-behavior-variants.test.ts`: workflow-152 observes
  explicit image insertion variant.
- `packages/safe-python/src/runtime/iso2022-jis-revision.test.ts`:
  iso2022_jp_2004 matches all scalar encodings in block 877568.

Exact isolated reruns passed: one credentials case, one docx case, and two encoding
block variants. Other cases excluded by those name filters are unmeasured, not
passes. No implementation change, assertion removal, timeout increase or worker
configuration change was made on that evidence. After the reported failures,
the remaining broad batch was stopped through its maintained SIGTERM/registered
process-group cleanup; the command exited 1. Remaining declared unit stages were
not completed, so full-repository unit validation remains an explicit delivery
blocker. Focused sql2csv results and successful repository lint do not qualify
this interrupted broad gate. Task-owned logs, capture scripts and screenshot
artifacts under out were purged after their results were recorded here.

## Additional user-edge review

The 2026-09-18 follow-up added three domain cases covering output backpressure
and both Error and falsey sink failures. All passed on the existing implementation:
no product defect was reproduced and no product fix was justified. The focused
sql2csv command/read-cleanup cohort passed 166 cases. Before these additions, the
maintained uncached csvkit unit route again passed 4,100 cases with the same one
skip and six todos; these remain unqualified. Workspace lint after the additions
and the selected csvkit workspace build closure passed.

A distinct agent added seven actual-Shell cases; see
`sql2csv-user-edge-validation.md` for observations and limits. Root registered
the new test in the maintained discovery assertion. Existing Safe Bash SQL
stress/lifecycle/stream-boundary tests passed 23 cases, and the maintained runner
route passed all 536 cases without skips or todos. The screenshot tool rendered
actual registered sql2csv help, duplicate/empty column labels, CSV quoting and
`-H -l` first-row output; root visually inspected the complete readable image.
Temporary visual artifacts were removed after inspection.

Safe Bash's maintained source/test and consumer typecheck route also passed,
including its expected negative-consumer diagnostics. The independent new
actual-Shell test file passed all seven cases with no skipped or todo cases.

This follow-up does not supersede the incomplete repository-wide unit gate
above or qualify previously named driver/isolation/codec/verbose blockers.
