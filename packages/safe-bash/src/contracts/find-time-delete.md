# Find time predicates and deletion

`find` adds `-mtime N`, `-mmin N`, `-newer FILE`, and `-delete` to its existing
Boolean expression grammar. These operate only through the supplied filesystem
and signal. No host process, identity service, permission model, or new backend
capability is introduced. A supplied backend may itself access authorized real
or remote storage; VFS operations are not a claim of host isolation.

## Time comparisons

`N` is an unsigned decimal integer, optionally prefixed with `+` or `-`.
Missing/malformed operands and comparisons outside safe integer millisecond
arithmetic fail with usage status 2 before traversal or expression actions.
Fractional numbers, exponent syntax, calendar/date strings, `-daystart`, other
time fields, and `-newerXY` variants remain unsupported.

The invocation captures `Date.now()` once. Let `age` be that captured time minus
the entry's `mtimeMs`, `day = 86400000`, and `minute = 60000`. GNU find's windows
are not identical for minute and day predicates:

| Predicate | Match |
| --- | --- |
| `-mtime N` | `N * day <= age < (N + 1) * day` |
| `-mtime +N` | `age > (N + 1) * day` |
| `-mtime -N` | `age < N * day + 1000` |
| `-mmin N` | `(N - 1) * minute <= age < N * minute` |
| `-mmin +N` | `age > N * minute` |
| `-mmin -N` | `age < N * minute` |

The one-second negative-day adjustment and strict signed boundaries match GNU
find's comparison origins, not a generic rounded-age comparison. Future times
are not clamped. Precision remains that of the backend's `mtimeMs`, not native
nanoseconds. Tests use a fixed clock for exact boundaries; native GNU 4.7.0
in-memory-descriptor controls validate windows away from clock races.

Each distinct `-newer` reference is inspected once before traversal, including
references in unreachable Boolean branches. A missing/inaccessible reference
fails before any print/delete/exec action. The predicate compares strictly
greater `mtimeMs`; equality is false. Captured reference timestamps survive
subsequent deletion or modification of their reference files. `-P` uses link
metadata; `-L` follows references, with lstat fallback only for missing targets.
The same existing `-P`/`-L` policy governs visited-entry time metadata.

## Deletion

`-delete` is a Boolean action: success is true, failure is false and sets the
overall exit status to 1. AND/OR/negation retain their normal short circuiting.
Its presence suppresses implicit `-print` and enables depth-first traversal,
even if execution never reaches the action. Explicit print actions still run
in expression order. `-prune` combined with `-delete` is rejected before effects
unless `-depth` is explicitly present. With explicit depth, pruning cannot stop
descent; its Boolean result can still short-circuit an action on that entry.

Files and final symlinks use nonrecursive, non-forced `fs.rm`; directories use
optional `fs.rmdir` with its strong empty-only contract. There is no recursive
removal fallback, and no prior empty listing substitutes for removal-time
emptiness. Actual-path capability declarations, readonly status, missing
`rmdir`, and explicitly weaker `snapshotRmdir` profiles are checked before the
selected mutation. Snapshot-marker directory removal is unsupported here.
Capabilities are checked when an action executes, not globally for unreachable
actions; earlier successful actions are not rolled back on a later refusal.

`-P` removes a link without traversing it. `-L` can delete individually matched
descendants through a directory link, then unlinks the link itself, not its
target directory. This follows the corrected GNU behavior rather than older
GNU releases that attempted rmdir on a followed directory link. Dangling links
remain removable; ancestor cycles retain the existing ELOOP behavior. Cached
metadata is not a namespace lease, race-proof identity check, or transaction.

The default `.` starting entry is retained; its descendants remain eligible.
Other backend root, terminal-dot, permission, missing-path, and nonempty errors
remain failures. In particular, empty-only removal cannot delete a newly
arriving child even if enumeration previously observed an empty directory.

## Limits and cancellation

The existing 1024 traversal-depth ceiling and per-directory entry cap remain.
Shell invocation/output/deadline limits still apply through the existing shell;
direct command callers supply their own outer budgets. These are not a global
filesystem-call quota or traversal snapshot. References are bounded by the
admitted argv, not an additional global reference policy.

Signals reach reference reads, capability resolution and removals; falsey abort
reasons retain their identity. Cancellation and output failure stop subsequent
effects but cannot undo completed deletion or preempt opaque backend work.
No `-ignore_readdir_race`, recursive deletion, mount-boundary support, `-execdir`,
ownership predicates, or new backend metadata semantics are added.
