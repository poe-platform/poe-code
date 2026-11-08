# Public prerequisite exit status — 2026-08-27

Original preflight commit21049bed already prevented product work, with23/23
bounded controls including two guard mutants. Its public `--preflight-only`
returned78, but `--execute` imported a launcher whose admission assertion
terminated with1. The original test explicitly asserted1. This was a public
exit-status inconsistency, not evidence that the missing-native suite ran.
Original source/evidence remain in Git; no old23-test capture is rewritten.

The public entry point now validates arguments, assesses prerequisites and
returns78 for refusal **before importing the execution launcher**. The launcher
retains its own independent admission/staging checks. No candidate/policy seal,
native profile, test discovery or product source changes. Three new controls
exercise both public modes with a missing, changed or nonexecutable mandatory
binary in isolated miniature Git repositories. Each observes exactly its native
issue, exit78, no output directory and no forbidden launcher-import sentinel.
The existing unreviewed-candidate assertion changes1→78 with the source fix.

Final bounded run:26/26 pass, zero skips/TODO/cancellation; two original mutant
controls remain. The seven originally omitted GNU tools are materialized only
for `--version` checks, not product execution. The first same-source26/26 TAP
also remains: its shell wrapper subsequently failed trying to assign zsh's
read-only `status` variable. A second wrapper used `test_exit`, preserving the
actual Node exit0. Neither attempt runs a whole suite.

`cohort-reconciliation.json` independently joins the original canonical and
same-source focused observations:122 test instances comprise114 original
failures plus8 already-passing instances. The focused122/122 is the whole
six-file cohort, not122 repaired failures and not a new score for b494. Original
failure categories remain28 nl +28 seq +17 seq diagnostics +23 unexpand +18
author-stress. The input capture hashes and eight original passing names are
recorded; no oracle or original result is edited.

Root separately approved the successor typing policy: `typecheck:all` builds
once and checks full current source/strict consumers; cold plain `typecheck`
exit78 is an expected prerequisite observation, neither a type pass nor a type
failure. That policy still needs independent review and an exact candidate
freeze before a new whole-gate policy is implemented or any broad run launches.
The currently sealed policy deliberately rejects unreviewed candidates.
