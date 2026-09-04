# WebDAV access compatibility release regression

GitHub run 33896404622 at cf742f0ea failed two existing canonical Bash
consumer tests after the WebDAV walk-deadline change: modes 0 and 4 must
not inherit the X-bearing raw-path caps. Both calls normalize to the root,
but instead fail with ENAMETOOLONG while stat handles the raw spelling.

Preserve the original tests and contract. Repair only the affected SafeFS
access path, with a focused in-memory regression. Keep the new direct stat
and write preflight limits, whole-walk deadlines, caller cancellation, and
timer cleanup. Execute-bearing modes must still reject oversized raw paths
before I/O. Do not remove the deadline fix or relax the failing assertions.

The Safe Bash package requires delegated investigation/implementation;
root retains integration, Git ownership, and release verification.

Validation includes the new SafeFS regression, WebDAV deadline tests,
the normal full build (including the bundled public SafeFS facade), and
the original canonical WebDAV directory-access consumers through node:test
in the virtual-bash workspace. Execute-bearing access retains public stat
dispatch, including cancellation after that call fulfills. The focused
SafeFS suite passes 370 tests across nine files after reproducing both
the raw-path regression and the public-dispatch cancellation regression.
Check focused lint and observe the complete GitHub release gates after
pushing. Passing the focused tests alone is not a successful release.
