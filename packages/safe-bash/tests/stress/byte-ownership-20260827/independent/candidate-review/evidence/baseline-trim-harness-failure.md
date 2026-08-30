# First baseline trim attempt: evidence transport failure

The first `baseline-trim` attempt built and genuinely packed/extracted the frozen
baseline successfully. Binding, build, npm-pack and package evidence are retained.
The test child returned, but the runner failed publishing its large TAP output:
the patch was passed as one process argument, and apply_patch did not start
(`status: null`). This is an evidence-harness failure, not a product score.
The volatile child output was not published; do not invent its denominator.

The runner now passes the patch on stdin rather than a large argv entry. No
frozen fixture, expected policy, vector or product file changed. Retry uses the
new phase `baseline-trim-v2`; the original scratch and partial evidence remain.
The complete first-candidate 30/30 correctness and 23/53 trim evidence already
published successfully and is unchanged. Runner hash is bound in each attempt.
