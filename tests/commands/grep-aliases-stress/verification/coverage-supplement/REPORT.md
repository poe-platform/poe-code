# Final additive coverage receipt — HOLD remains

This completes two explicit variants missed in the preceding coverage audit:
S02 owned reused-buffer **internal pipe-to-file**, four combinations of alias and
4/8-byte fragments; S03 shared output budget **inside a pipeline**, one case.
Main evidence commit 7550a317 and its ec73580e seal are unchanged, as are the
original 38-case corpus and BSD/GNU captures. No source fix or oracle change is
made in this supplement. Product is the same committed, physically moved
04644bc2 package already built and strictly qualified in the main receipts.

Final supplement attempt 03 passes all five cases and observes five actual worker
creates and exits, zero active workers, no timeout or forced cleanup. Main final
77 cases remain 75 pass/two fail. The combined final cohorts therefore contain
**82 executed subcases: 80 pass and two fail**, both the same shared external
stdin return-rejection defect. All 38 original groups execute; 37 pass and S07
fails. Five additional alias-adversarial groups pass; the separate public grep
control remains failed. The complete native counts stay **BSD exact 16/26, GNU
exact 0/26, GNU stdout/status/file-effects projection 26/26**, with no warning
stripping. Full alias API, options, source/package hashes, trust qualifications
and the root blocker are in the unchanged parent REPORT.md and ROOT-BLOCKER.md.

Attempts 01 and 02 each retain four passes/one failed targeting assertion. The
small family queue selected for other controls exhausted before S03 reached the
intended output budget; the last pipeline command then returned zero without
pipefail, with the upstream QUEUE_EXHAUSTED diagnostic retained. Attempt 02 adds
exact raw outcome capture; it records 1024 stdout bytes and that diagnostic.
S03 attempt 03 changes only its family queue policy to maxQueuedRequests 64 and
maxQueuedBytes 65536. The 8192-byte input, maxWorkers one, and 6144-byte shared
output budget stay unchanged. It now actually rejects with ShellLimitError for
maxOutputBytes. This is disclosed test isolation of distinct limits, not a waived
budget failure or modification of the original tiny-queue S04 assertions.

All three supplement harness snapshots, strict-type results, raw TAP and observed
worker identities are retained. The supplement creates 15 workers across its
three attempts; all exit. Together with the unchanged seven main attempts,
**586 real workers were observed and all 586 exited**. Source and worker activity
are stopped. No shared source, root/package/default export, or author test was
edited. HOLD still requires the shared owner to preserve the outer input cursor's
return rejection and supply a new immutable candidate for replay.

Source fix: `04644bc2c15d67155f5f4b170a66fc9bef3f6e3d`.
Main evidence: `7550a317`.
Alias source SHA-256: `c2333d21c049651a3ef75f811f7c3f516a364d41fdbed2f3683388fba0adbcff`.
Package SHA-256: `3757f9f11c9894d94cec8bbd7cdd45380633757f6894a252bdd977e12a5052bb`.
Main evidence seal: `ec73580edebc95d1ebc8a10cd7f8ed22ac9c879c483917f6cd51fe683a01c4d2`.
Resume thread: `01a04392-fd24-7870-a9d4-abfdce728e4d`.
