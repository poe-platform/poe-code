# PlainYearMonth public integration reconciliation

## Scope

Reconcile the pending public constructor, input adapter and tests. Review covers
numeric coercion and calendar validation before reference-day conversion and
new-target prototype selection; private-field copying; ordered input reads;
calendar arithmetic/differences; conversion to PlainDate; comparison/equality
with reference dates; formatting; locale handling; and intrinsic registration.

The factory included its locale function twice in the registration list. A new
direct factory test reproduced 25 registrations for 24 distinct functions.
Remove the duplicate list entry. This is redundant setup work, not evidence of
a user-visible locale repair or an end-to-end performance improvement.

## Verification

The identical YearMonth cohort plus the new registration test ran on three
installed runtimes, with no skips:

| Runtime | Passed | Failed |
| --- | ---: | ---: |
| Node 22.23.2 | 99 | 3 |
| Node 18.20.8 | 102 | 0 |
| Node 26.8.1 | 102 | 0 |

The three Node 22 failures are native expected-value preconditions in the
locale tests: the ISO year/long-month formatter emits `2000 ` without February.
They occur before the guest assertion. Keep these assertions and the existing
runtime default unchanged; successes on other hosts do not resolve this gap.
See `safejs-iso-locale-month-data.md` for repair constraints.

Native Node 26.8.1 and guest named-property metadata match for all five
constructor properties and 22 prototype properties, including descriptor flags
and function/accessor names and arities.
Package TypeScript checking with `--noEmit` and focused ESLint passed.

## Remaining work and delivery

The locale-data problem is unresolved. These current-working-tree checks do not
prove a green full package gate or standalone HEAD completeness. Public
namespace/Instant and snapshot integration still remain partly uncommitted.
No visual CLI change. Commit this integration and its registration correction
locally; keep pushes, releases and issue closures paused.
