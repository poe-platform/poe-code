# csvstat behavior prerequisite verification

Verified against the working tree on 2026-09-20. `behavior-csvstat` remains
incomplete; no acceptance cell was implemented or closed by this inspection.

The preceding `engine-csvstat` task in `safe-bash-csvstat.md` is marked
implement/refactor/test done, but this is contradicted by the repository and
`safe-bash-csvstat-engine-prerequisites.md`, which records an incomplete engine.
There is no `packages/safe-bash-command-csvstat` implementation, no csvsort
inference implementation, and no admitted shared CSV parser/selector/inference
workspace. No csvstat export exists in `packages/safe-bash/package.json`.
File-name and workspace-manifest searches provided this evidence; this is a
missing implementation, not a failing runtime statistic.

The engine task requires shared parsing and inference contracts and explicitly
says not to duplicate shared engines. The behavior task requires admitted
first-party Decimal/calendar/locale primitives. Exact aggregation must retain
the distinction between 9007199254740993 and 9007199254740992 before JSON float
conversion; JavaScript Number aggregation cannot satisfy this control. Temporal
statistics also need typed microsecond values and instant-based identity before
frequency, unique and extrema can be implemented correctly.

`packages/safe-bash/integration-boundaries.json` holds the XAN CSV/selector
paths; `packages/safe-bash/tsconfig.build.json` excludes them. Their contents
were not read, imported or extracted. The locally deleted package-pattern
document was read at its archived successor without restoring unrelated edits.

Required next increment: implement and admit the shared parser, selector,
Decimal and whole-column inference contracts under `engine-csvstat`, with
original failing memory tests, versioned semantics, explicit capabilities and
resource/cancellation accounting. Then behavior tests can consume those
contracts and the independent controls in `safe-bash-csvstat-acceptance.md`.
That matrix already records scalar, null, frequency, Unicode, output and
interaction expectations, with grammar/chunk/cancellation/packed cells open.

No placeholder package or failing missing-module test was added. No code was
changed, so no runtime tests, lint/build checks, CLI screenshots or installed
artifact verification are claimed. No commit, push, release or publication was
performed. The existing plan status and unrelated working-tree edits were
preserved; the engine completion mismatch requires reconciliation by its owner.
