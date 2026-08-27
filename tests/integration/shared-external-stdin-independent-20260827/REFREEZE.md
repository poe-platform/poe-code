# Revision 2, before candidate

No candidate route exists and no live/candidate input implementation was
inspected. The first 32-case freeze is immutable in Git at
`0ec75ef320ecaea9fc66e1ba952f3961c917685c`. Its original baseline results are
preserved separately. `ATTEMPTS.md` enumerates all expectation corrections and
the three added checks; no product source changed and no original failure is
discarded. This fixture commit freezes 35 behavior cases and two controls.

The EOF rule in the initial FROZEN.md was overstrong: natural EOF does not
require calling return at either layer. The source defect concerns a return
actually selected for ordinary awaiting, not invoking return after every EOF.
Ordinary command read/sink failures can become nonzero results; only selected
execution rejections retain rejection precedence. These are contract corrections,
not a relaxation of the normal awaited-return error requirement.
