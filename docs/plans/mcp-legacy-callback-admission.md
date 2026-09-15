# Legacy callback admission and cancellation

Three focused regressions reproduced duplicate active IDs invoking another callback, no incoming admission limit, and disposal failing to notify a legacy callback.

Reject duplicate active IDs as invalid requests and excess callbacks as capacity errors. Apply the configured maxConcurrentRequests independently to incoming work. Each callback owns an AbortController; cancellation and disposal abort it. Keep cancelled callbacks admitted until their work settles, preventing noncooperative handlers from bypassing the bound. Preserve the existing result suppression after cancellation.

Both legacy server callbacks and modern MRTR callbacks now receive a readonly request context with a required signal. Existing callbacks accepting fewer arguments remain compatible.

Focused admission and exchange-capacity cases pass. Full client suite passes: 473 tests across 28 files. Client lint and the selected six-workspace build closure pass. Remaining callback audits include legacy method-specific parameter/result validation and output backpressure.
