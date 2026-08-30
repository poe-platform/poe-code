# Author findings and narrow reconciliation requests

Candidate remains `c26892c3a1a419311c9cf46a6c2976e696e00624`. No production
changes followed the first author run. These findings are not author permission
to change Plato's frozen fixtures. All original failures remain scored as such.

## P39: missing function arguments, not an arithmetic cursor regression

Original source and moved observations are exactly `?\nb\n`, status0, empty
stderr, versus frozen `a\nb\n`. The frozen function is invoked as `work` after
outer `set -- -ab`; existing runtime replaces its positional arguments with the
empty invocation argument list. Therefore inner getopts sees EOF, not `-ab`.

Presealed diagnosis `d9d92161`, D01, runs accepted464 with ordinary `OPTIND=1`
instead of LET. It also produces `?\nb\n`; the delegating observer records
inner functionDepth1/positional`[]`, outer positional`["-ab"]`. D03 supplies
`work "$@"` to the unchanged candidate and records inner positional`["-ab"]`,
actual arithmetic OPTIND reset and exact `a\nb\n`. The unmodified P37/P38
cursor-reset/prefix tests already pass both layouts.

**Request to Plato/root:** freeze a narrow P39 input correction adding explicit
function arguments if the intended invariant is local cursor restoration; keep
original P39 failure. Do not alter getopts/function argument inheritance.

## P58: unsupported set -u prevents LET admission

Original source/moved output is empty, status2, exact stderr:

```
set: unsupported shell option; supported forms are -e, +e, -- arguments and -o/+o pipefail or errexit
```

D02 executes original `set -u; let absent` on accepted464 without LET: same
outcome, observer records only `set`, no LET admission. D04 executes
`let absent` on the moved candidate: status1, empty stdout/stderr as the existing
arithmetic unset-name-zero semantics require.

**Request:** remove only unsupported `set -u` in a separately frozen version of
the arithmetic-unset check. No nounset implementation or grammar expansion.

## Negative API: intended missing export, TS2724 instead of TS2305

Actual complete strict compiler diagnostic:

```
negative-api.mts(1,10): error TS2724: '"virtual-bash"' has no exported member named 'createLetCommands'. Did you mean 'createFileCommands'?
```

Exactly one diagnostic, exit2, correct import token/location. Type trace binds
the moved package root declaration SHA256
`d3e61ecf6b1db842cdfb51c137242c86d03fcf1d4678c4e210ab0ee923aa09f1` and its
actual declaration closure, not source declarations. Changing only the imported
identifier to existing `Shell` makes the strict check pass. The positive public
consumer, exact TS2322 limit negative and both positive inversions pass.

**Request:** case-specific code/message reconciliation, not a diagnostic
whitelist or product export. Original type matcher remains a reject (4/5
expected outcomes); no type rerun was made to rescore it.

## A23: author assertion overrequired child success

Original A23 confirmed pending root settlement until owned cleanup release,
but asserted a fulfilled child. It observed a rejected child and fulfilled
root0. The original serialized Error was `{}`; its name/message/stack were not
retained. Those missing old bytes are **not reconstructed**.

D05 collects NEW full rejection observations with unchanged loaded code:
accepted464 `:` child, candidate `:` child and candidate LET child all reject
with Error `Invocation is closed`; all have the same recorded order:
invoke, handler-return, cleanup-enter, release, cleanup-done, root-settled.
Root remains pending before release, returns0 after cleanup, and each Shell
disposes. This is inherited scope retirement, not LET losing cleanup. No
same-object identity is claimed across separate executions.

**Disposition:** author-only overstrict assertion; preserve original A23
failure. The independent S26 procedure requires settled/drained children, not
unconditional child fulfillment. Do not introduce new runtime boundary policy.

## Packaging/preparation failures retained

- Initial preparation rejected `/usr/bin/tar` as a symlink before any product
  execution. Resume bound explicit regular `/usr/bin/bsdtar`, verifying every
  already-materialized byte/mode. Original preparer and raw failure retained.
- Post-run archive verification rejected unknown `._README.md` in bsdtar's
  original source archive. That archive/hash/report remain historical, NOT
  qualified. Presealed `88d607f4` writes a separate portable/noPax archive with
  the same265 inputs; strict verification confirms all265 regular path/mode/
  size/hash identities and rejects extras. Full npm package remains unchanged.

Neither correction reruns product cases, types, native observations or builds.
No failing tail was dropped: source, moved, all types, guards, seven actual
rebuilt mutants and source archive creation all executed in the original run.
No LET-specific production defect is established by this author evidence;
independent review/root acceptance is still required.
