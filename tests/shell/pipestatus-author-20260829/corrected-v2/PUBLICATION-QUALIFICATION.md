# Publication-only qualifications

The first results-publication batch returned 128 because another Git operation
held `.git/index.lock`. Its exact output is retained at
`/private/tmp/safe-bash-pipestatus-corrected/result-commit.txt`. No lock was
removed, no validation was rerun, and no source or failure expectation changed.

That batch logged three prospective Git roles before issuing its guarded
sequence, but did not print per-command completion markers. Consequently its
exact launched count is bounded at one through three Git processes, not claimed
as three observed starts. All foreground work returned with the enclosing
shell; there is no active job or unknown-retirement observation.

A later documentation patch failed to match context and changed no file; its
output remains `publication-note.log` in the same external capture root. This
ordinary helper failure does not alter the successful compiler/pure results.

The final publication batch records each command return separately. If all its
five known roles complete, the total fresh campaign is **34–36 actual starts**,
with a finite upper bound of 36, peak known three. Do not turn the earlier
reservation log into an exact observed census. Final raw returns and owned
status are in `/private/tmp/safe-bash-pipestatus-corrected/FINAL.txt`.

The earlier publication snapshot remains literal: 21 starts through that point,
9,125,345 scratch bytes, zero Shell/native/Worker execution. This qualification
is about administrative publication accounting only, not unknown product cleanup
or an inferred semantic failure. The original phase's 23/24 and old artifact stay
unchanged.
