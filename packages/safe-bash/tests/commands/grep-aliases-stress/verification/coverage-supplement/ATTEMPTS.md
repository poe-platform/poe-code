# Additive pipeline coverage audit

Evidence commit 7550a317 and its complete ec73580e seal remain unchanged.
The post-seal audit identified missing explicit S02 reused-buffer internal-pipe
to-file variants and S03 pipeline output-budget coverage. This is an additive
five-case supplement on the same immutable 04644bc2 moved package, not a product
change, replacement of the 38 original inputs, or rerun of the entire grep suite.

Attempt 01: strict types pass; four S02 variants pass and S03's expected rejection
is absent. All five actual workers exit. The initial failure record did not save
the fulfilled ShellResult, so attempt 02 adds raw outcome capture without changing
the assertion. The original failed receipt and source snapshot remain retained.

Attempt 02: the same four passes and one failure, with five worker exits. S03
returns status zero, 1024 stdout bytes, and an egrep QUEUE_EXHAUSTED diagnostic.
The upstream command hits the test's deliberately tiny queue policy before the
intended shared output budget. Without pipefail the last fgrep status is zero.
This is not an observed unbounded output pass or a proven missing output-budget
rejection; the test had reached the wrong independently configured resource limit.

Attempt 03 keeps the same 8192-byte input and 6144-byte shared output budget, but
gives S03 alone maxQueuedRequests 64 and maxQueuedBytes 65536 so the family queue
does not confound the target. The original S04 tiny-queue tests and all other
supplement settings stay unchanged. The assertion still requires the selected
ShellLimitError for maxOutputBytes; no failure or stderr is hidden or relabeled.
