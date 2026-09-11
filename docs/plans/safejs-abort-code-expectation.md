# Native AbortError code expectation

The maintained SafeJS package run reproduced one outdated filesystem assertion:
AbortController's native DOMException reached the guest with code 20, while the
test expected no code. A direct native AbortController probe confirms name
AbortError, message "This operation was aborted", and code 20. Commit 5c0365833
already intentionally preserves native DOMException codes for DataCloneError
and other DOMExceptions. Do not remove that behavior to satisfy this assertion.

Update only the expected abort result, preserving the check that no filesystem
path or filesystem-specific error replaces the abort. Run the filesystem bridge
tests and lint, then commit and push this test correction separately from the
DataView feature. No production behavior changes are included.

All nine filesystem bridge tests passed in the focused rerun alongside the 51
DataView tests (60 total, 2.05s).
