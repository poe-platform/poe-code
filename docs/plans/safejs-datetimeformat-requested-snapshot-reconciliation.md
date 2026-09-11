# DateTimeFormat requested-option snapshot integration

## Scope

Reconcile only the pending requestedOptions snapshot field across the heap-node
type, capture, validation and restore paths. Temporal and weak-state node
integration in those same files remains separate work.

Original requested options cannot be recovered from resolved defaults: an
implicit formatter can format PlainTime, while explicit date-only fields are
not equivalent. Preserve the original record for new snapshots. Legacy records
without it remain supported and retain undefined requestedOptions, allowing
the existing resolved-options fallback rather than inventing original intent.

Validation restricts option names and primitive types, requires fractional
digits to be integral and in range, and checks that requested options resolve
to the saved formatter options. Accessor-bearing records are rejected without
invoking their getters.

## Evidence

The existing eight requested-option tests passed before this reconciliation.
Added an implicit PlainTime-formatting round trip and a legacy formatter round
trip, including numeric formatting and absence of synthesized requested options.
This is integration and extra coverage, not a newly discovered algorithm fix.

The final Node 22 run passed 23 tests across snapshot requested options, public
Temporal formatting and cached Intl proxy coercion files.
All ten snapshot checks also passed on Node 18.20.8. Package TypeScript checking
with `--noEmit` passed.
Focused ESLint passed for all three snapshot runtime files and the test file.

## Commit boundaries and remaining work

Stage only the selected DateTimeFormat hunks with a separate index, then sync
the real index to the new HEAD without staging other snapshot work. Preserve
the unrelated staged SafeBash edits.

Current-worktree tests do not establish standalone HEAD or complete snapshot
support. Temporal, weak-state and object-model integration remain pending;
the full package gate and documented Intl compatibility gaps remain open.
No visual CLI change. Commit locally without push, release or issue closure.
